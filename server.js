const http = require('http')
const fs = require('fs')
const ws = require('ws')
const stream = require('stream')
const zlib = require('zlib')

const log = console.log
const first = x => x[0]
const second = x => x[1]
const last = x => x[x.length-1]
const tail = x => x.slice(1)

const seconds = x => x * 1000
const minutes = x => seconds(60*x)

let CONF = {}
let video = null
const connected = new Set()

const MIME =
	{ text: 'text/plain',
	html: 'text/html',
    xhtml: 'application/xhtml+xml',
	bin: 'application/octet-stream',
	json: 'application/json',
	mp4: 'video/mp4',
	webm: 'video/webm',
	vtt: 'video/vtt', }

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
		{ s(internal_server_error(e)) }}

function route(req)
	{ switch(true)
		{ case req.url === '/':
			return front_page
		case req.url.endsWith('/'):
			return list_directory
		default:
			return static_file }}

function not_found(x)
	{ return ({ status: 404, data: `not found: ${x}`, mime: MIME.text }) }

function serve(res)
	{ return function({ status, data, mime=MIME.bin })
		{ res.writeHead(status, { 'Content-Type' : mime, 'Content-Encoding': 'gzip' })
		if (data instanceof stream.Readable)
			data.pipe(zlib.createGzip()).pipe(res)
		else
			gzip(data).then(x => res.end(x)).catch(() => res.end('')) }}

function front_page()
	{ return access_file('public/index.xhtml', fs.R_OK)
		.then(x => ({ status: 200, data: fs.createReadStream(x), mime: MIME.xhtml })) }

function list_directory()
	{ if (!auth) return Promise.resolve(unrecognised())
    const x = 'public'+req.url
	return read_dir(x).then(xs => ({ status: 200, data: JSON.stringify(xs), mime: MIME.json })) }

function static_file(req)
	{ if (!auth) return Promise.resolve(unauthorized())
	const x = 'public'+req.url
	return access_file(x, fs.R_OK)
		.then(x => ({ status: 200, data: fs.createReadStream(x), mime: guess_mime_type(x) }))
		.catch(() => Promise.resolve(not_found(x))) }

function internal_server_error(x)
	{ return ({ status: 500, data: `internal server error: ${x}`, mime: MIME.text }) }

function unauthorized()
	{ return ({ status: 401, data: 'unauthorized', mime: MIME.text }) }

main()
