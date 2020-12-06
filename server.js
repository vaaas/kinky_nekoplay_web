const http = require('http')
const fs = require('fs')
const ws = require('ws')
const stream = require('stream')
const zlib = require('zlib')

const log = console.log
const first = x => x[0]
const second = x => x[1]
const last = x => x[x.length-1]

const seconds = x => x * 1000
const minutes = x => seconds(60*x)
const hours = x => minutes(60*x)
const days = x => hours(24*x)
const months = x => days(30*x)

let CONF = {}
let video = null
const connected = new Set()

const CACHE =
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

async function main()
	{ CONF = JSON.parse(await read_file('config.json'))

	const wss = new ws.Server({ noServer: true })
		.on('connection', on_ws_connection)

	http.createServer(request_listener)
	.on('upgrade', (req, socket, head) => verify_request(req, socket, head, wss))
	.listen(CONF.port, CONF.hostname, () => log(`server running at ${CONF.hostname}:${CONF.port}`))

	setInterval(ping, minutes(10)) }

function guess_mime_type(x)
	{ const ext = last(x.split('.'))
	const type = MIME[ext]
	return type ? type : MIME.ext }

function ping()
	{ for (const x of connected.values())
		{ if (!x.pong) x.close()
		else
			{ x.pong = false
			x.send(msg('ping')) }}}

function on_ws_connection(ws)
	{ connected.add(ws)
	ws.name = 'anonymous'
	ws.pong = true
	ws.on('message', on_message)
	ws.on('close', on_close_or_error)
	ws.on('error', on_close_or_error)
	broadcast(msg('join', ws.name))
	if (video) ws.send(msg('video', video)) }

function on_close_or_error()
	{ connected.delete(this)
	if (connected.size === 0) video = null }

function on_message(message)
	{ try
		{ const x = JSON.parse(message)
		switch (first(x))
			{ case 'name':
				let old = this.name
				this.name = second(x)
				broadcast(msg('name', old, this.name))
				break
			case 'chat':
				broadcast(msg('chat', this.name, second(x)))
				break
			case 'pause':
				broadcast(msg('pause'))
				break
			case 'play':
				broadcast(msg('play', second(x)))
				break
			case 'video':
				video = second(x)
				broadcast(msg('video', video))
				break
			case 'pong':
				this.pong = true
				break
			default:
				this.send(msg('error', 'unrecognised command: ' + first(x)))
				break }}
	catch (e)
		{ this.send(msg('error', e)) }}

function msg(type, ...args)
	{ return JSON.stringify([type, ...args]) }

function broadcast(x)
	{ connected.forEach(c => c.send(x)) }

function verify_request(req, socket, head, wss)
	{ if (!auth(req)) return socket.destroy()
	wss.handleUpgrade(req, socket, head,
		ws => wss.emit('connection', ws, req)) }

function parse_cookies(req)
	{ const header = req.headers.cookie
	if (!header) return {}
	else return Object.fromEntries
		(header.split(';').map(x => x.split('='))) }

function auth(req)
	{ const cookies = parse_cookies(req)
	return cookies.p === CONF.password }

function read_file(x)
	{ return new Promise((yes, no) =>
		fs.readFile(x, (err, data) =>
			err ? no(err) : yes(data))) }

function access_file(x, mode)
	{ return new Promise((yes, no) =>
		fs.access(x, mode, err => err ? no(err) : yes(x))) }

function stat(x)
	{ return new Promise((yes, no) =>
		fs.stat(x, (err, stat) => err ? no(err) : yes(stat))) }

function gzip(x)
	{ return new Promise((yes, no) =>
		zlib.gzip(x, (err, x) => err ? no(err) : yes(x))) }

function read_dir(x)
	{ return new Promise((yes, no) =>
		fs.readdir(x, (err, files) => err ? no(err) : yes(files))) }

async function request_listener(req, res)
	{ const f = route(req)
	const s = serve(res)
	if (f === null) return s(not_found(req.url))
	try
		{ s(await f(req)) }
	catch(e)
		{ console.log(e)
		s(internal_server_error(e)) }}

function route(req)
	{ switch(true)
		{ case req.url === '/':
			return front_page
		default:
			return dir_or_file }}

function etag(mtime)
	{ return `"${(mtime.getTime()-1577829600000).toString(36)}"` }

function not_found(x)
	{ return ({ status: 404, data: `not found: ${x}`, mime: MIME.text }) }

function serve(res)
	{ return function({ status, data, mime=MIME.bin, cache='public', etag=null })
		{ const headers =
			{ 'Content-Type' : mime,
			'Content-Encoding': 'gzip',
			'Cache-Control': cache }
		if (etag) headers.etag = etag
		res.writeHead(status, headers)
		if (data instanceof stream.Readable)
			data.pipe(zlib.createGzip()).pipe(res)
		else
			gzip(data).then(x => res.end(x)).catch(() => res.end('')) }}

function front_page()
	{ const x = 'public/index.xhtml'
	return access_file('public/index.xhtml', fs.R_OK)
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

function list_directory(x)
	{ return read_dir(x).then(xs => ({
		status: 200,
		data: JSON.stringify(xs),
		mime: MIME.json })) }

function static_file(x, stat)
	{ return ({
		status: 200,
		data: fs.createReadStream(x),
		mime: guess_mime_type(x),
		cache: CACHE.immutable,
		etag: etag(stat.mtime), }) }

function internal_server_error(x)
	{ return ({
		status: 500,
		data: `internal server error: ${x}`,
		mime: MIME.text }) }

function unauthorized()
	{ return ({
		status: 401,
		data: 'unauthorized',
		mime: MIME.text }) }

main()
