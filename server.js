'use strict'
// jshint node: true

const http = require('http')
const fs = require('fs')
const ws = require('ws')
const stream = require('stream')

const log = console.log
const first = x => x[0]
const second = x => x[1]
const last = x => x[x.length-1]
const split = d => x => x.split(d)

const seconds = x => x * 1000
const minutes = x => seconds(60*x)
const hours = x => minutes(60*x)
const days = x => hours(24*x)
const months = x => days(30*x)

function main()
	{ const wss = ws_server()
	http_server(wss) }

async function http_server(wss)
	{ const CACHE =
		{ immutable: `public, max-age=${months(6)/1000}, immutable`,
		frontpage: `public, max-age=${months(1)/1000}` }

	const MIME =
		{ text: 'text/plain',
		html: 'text/html',
		xhtml: 'application/xhtml+xml',
		css: 'text/css',
		js: 'text/javascript',
		bin: 'application/octet-stream',
		json: 'application/json',
		mp4: 'video/mp4',
		webm: 'video/webm',
		vtt: 'video/vtt',
		png: 'image/png' }

	function guess_mime_type(pathname)
		{ let x = last(pathname.split('.'))
		x = MIME[x]
		return x ? x : MIME.bin }

	function upgrade_wss(req, socket, head, wss)
		{ if (!auth(req)) return socket.destroy()
		wss.handleUpgrade(req, socket, head,
			ws => wss.emit('connection', ws, req)) }

	function parse_cookies(req)
		{ const header = req.headers.cookie
		return header ?
			Object.fromEntries(header.split(';').map(split('='))) :
			{} }

	const auth = x => parse_cookies(x).p === CONF.password

	const read_file = x => new Promise((yes, no) =>
		fs.readFile(x, (err, data) =>
			err ? no(err) : yes(data)))

	const access_file = (x, mode) => new Promise((yes, no) =>
		fs.access(x, mode, err => err ? no(err) : yes(x)))

	const stat = x => new Promise((yes, no) =>
		fs.stat(x, (err, stat) => err ? no(err) : yes(stat)))

	const read_dir = x => new Promise((yes, no) =>
		fs.readdir(x, (err, files) => err ? no(err) : yes(files)))

	async function request_listener(req, res)
		{ const f = route(req)
		try
			{ serve(res, await f(req)) }
		catch(e)
			{ console.log(e)
			serve(res, internal_server_error(e)) }}

	const route = x => x.url === '/' ? front_page : dir_or_file

	const etag = mtime => `"${(mtime.getTime()-1577829600000).toString(36)}"`

	function serve(res, { status, data, mime=MIME.bin, cache='public', etag=null })
		{ const headers =
			{ 'Content-Type' : mime,
			'Cache-Control': cache }
		if (etag) headers.etag = etag
		res.writeHead(status, headers)
		if (data instanceof stream.Readable)
			data.pipe(res)
		else
            res.end(data) }

	function front_page()
		{ const x = 'public/index.xhtml'
		return access_file(x, fs.R_OK)
			.then(stat)
			.then(stat => ({
				status: 200,
				data: fs.createReadStream(x),
				mime: MIME.xhtml,
				etag: etag(stat.mtime),
				cache: CACHE.frontpage })) }

	function dir_or_file(req)
		{ if (!auth) return Promise.return(unauthorized())
		const x = 'public' + req.url
		return access_file(x, fs.R_OK)
			.then(stat)
			.then(stat => stat.isDirectory() ?
				list_directory(x) :
				stat.isFile() ?
				static_file(x, stat) :
				Promise.reject(new Error('not a directory or a file'))) }

	const list_directory = x => read_dir(x)
		.then(xs =>
			({ status: 200,
			data: JSON.stringify(xs),
			mime: MIME.json }))

	const static_file = (x, stat) =>
		({ status: 200,
		data: fs.createReadStream(x),
		mime: guess_mime_type(x),
		cache: CACHE.immutable,
		etag: etag(stat.mtime), })

	const internal_server_error = x =>
		({ status: 500,
		data: `internal server error: ${x}`,
		mime: MIME.text })

	const unauthorized = () =>
		({ status: 401,
		data: 'unauthorized',
		mime: MIME.text })

	const CONF = JSON.parse(await read_file('config.json'))

	const server = http.createServer(request_listener)
		.on('upgrade', (req, socket, head) => upgrade_wss(req, socket, head, wss))
	if (CONF.socket)
		access_file(CONF.socket, fs.F_OK)
		.then(() => fs.rmSync(CONF.socket))
		.catch(() => true)
		.finally(() => server.listen(CONF.socket, () => log(`server running at unix:${CONF.socket}`)))
	else
		server.listen(CONF.port, CONF.hostname, () => log(`server running at ${CONF.hostname}:${CONF.port}`))
	return server }

function ws_server()
	{ let video = null
	let paused = true
	let play_limit = 0

	const reset_limit = x => x.limit=0

	const on_close_or_error = () => { if (wss.clients.size === 0) video = null }

	const on_ws_connection = ws =>
		{ ws.name = 'anonymous'
		ws.pong = true
		ws.limit = 0
		ws.on('message', on_message(ws))
		ws.on('close', on_close_or_error)
		ws.on('error', on_close_or_error)
		broadcast(msg('notice', `${ws.name} has joined`))
		if (video) ws.send(msg('video', video)) }

	function ping_or_close(x)
		{ if (!x.pong) return x.close()
		x.pong = false
		x.send(msg('ping')) }

	const msg = (type, ...args) => JSON.stringify([type, ...args])

	const broadcast = x => wss.clients.forEach(c => c.send(x))

	const on_message = ws => message =>
		{ if (ws.limit > 100) return
		ws.limit++
		let x = null
		try { x = JSON.parse(message) }
		catch (e) { return ws.send(msg('notice', 'error parsing json')) }
		switch (first(x))
			{ case 'name':
				let old = ws.name
				ws.name = second(x)
				broadcast(msg('notice', `${old} is now known as ${ws.name}`))
				break
			case 'chat':
				broadcast(msg('chat', ws.name, second(x)))
				break
			case 'pause':
				if (paused) return
				paused = true
				broadcast(msg('pause'))
				broadcast(msg('notice', `${ws.name} has paused playback`))
				break
			case 'play':
				if (!paused || play_limit > 3) return
				play_limit++
				paused = false
				broadcast(msg('play', second(x)))
				broadcast(msg('notice', `${ws.name} has resumed playback`))
				break
			case 'video':
				video = second(x)
				paused = true
				broadcast(msg('video', video))
				broadcast(msg('notice', `${ws.name} has selected ${video} for playback`))
				break
			case 'pong':
				ws.pong = true
				break
			default:
				ws.send(msg('notice', 'unrecognised command: ' + first(x)))
				break }}

	const wss = new ws.Server({ noServer: true })
		.on('connection', on_ws_connection)

	setInterval(() => wss.clients.forEach(ping_or_close), minutes(10))
	setInterval(() =>
		{ play_limit = 0
		wss.clients.forEach(reset_limit) },
		minutes(1))
	return wss }

main()
