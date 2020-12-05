const http = require('http')
const fs = require('fs')
const ws = require('ws')

const log = console.log
const first = x => x[0]
const second = x => x[1]
const tail = x => x.slice(1)

let CONF = {}
const connected = new Set()

async function main()
	{ CONF = JSON.parse(await read_file('config.json'))

	const wss = new ws.Server({ noServer: true })
		.on('connection', on_ws_connection)

	http.createServer(request_listener)
	.on('upgrade', (req, socket, head) => verify_request(req, socket, head, wss))
	.listen(CONF.port, CONF.hostname, () => log(`server running at ${CONF.hostname}:${CONF.port}`)) }

function on_ws_connection(ws)
	{ connected.add(ws)
	ws.name = 'anonymous'
	ws.on('message', on_message)
	ws.on('close', () => connected.delete(ws))
	ws.on('error', () => connected.delete(ws))
	broadcast(msg('join', ws.name)) }

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

async function request_listener(req, res)
	{ const f = route(req)
	const s = serve(res)
	if (f === null) return s(not_found(req.url))
	try
		{ s(await f(req)) }
	catch(e)
		{ s(internal_server_error(e.message)) }}

function route(req)
	{ switch(req.url)
		{ case '/':
			return front_page
		case '/video':
			return video
		default: return null }}

function not_found(x)
	{ return ({ status: 404, data: `not found: ${x}` }) }

function serve(res)
	{ return function({ status, data })
		{ res.writeHead(status).end(data) }}

function front_page()
	{ return read_file('index.html')
	.then(x => ({ status: 200, data: x })) }

function video()
	{ if (!auth) return Promise.resolve(unauthorized())
	else return read_file('video')
	.then(x => ({ status: 200, data: x })) }

function internal_server_error(x)
	{ return ({ status: 500, data: `internal server error: ${x}` }) }

function unauthorized()
	{ return ({ status: 401, data: 'unauthorized' }) }

main()
