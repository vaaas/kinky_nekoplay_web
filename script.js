'use strict'
// jshint browser: true

const first = x => x[0]
const second = x => x[1]
const last = x => x[x.length-1]
const qs = x => document.querySelector(x)
const randint = (a, b) => Math.floor(Math.random()*(b-a) + a)

let ws
let chat
let chatlog
let video
let track
let input
const colours = new Map()

class Timed
	{ constructor(f, t)
		{ this.f = f
		this.t = t
		this.id = null }
	run()
		{ clearTimeout(this.id)
		this.id = setTimeout(this.f, this.t) }
	cancel() { clearTimeout(this.id) }}

function get(x)
	{ return new Promise((yes) =>
		{ const req = new XMLHttpRequest()
		req.onload = () => yes(req.responseText)
		req.open("GET", x)
		req.send() })}

function empty(x)
	{ while(x.firstChild) x.firstChild.remove() }

class Elem
	{ constructor(x)
		{ this.x = typeof x === 'string' ? document.createElement(x) : x }
	static of(x) { return new Elem(x) }
	text(x)
		{ this.child(document.createTextNode(x))
		return this }
	child(x)
		{ this.x.appendChild(x)
		return this }
	children(xs)
		{ for (const x of xs) this.child(x)
		return this }
	class(x)
		{ this.x.className = x
		return this }
	colour(x)
		{ this.x.style.color = x
		return this }
	value(x)
		{ this.x.value = x
		return this }
	get()
		{ return this.x }}

function colour(x)
	{ if (!colours.has(x))
		{ const h = randint(0, 359)
		const s = randint(20, 90)
		const l = randint(40, 80)
		colours.set(x, `hsl(${h}, ${s}%, ${l}%)`) }
	return colours.get(x) }

function open_websocket_connection(x)
	{ return new Promise((yes, no) =>
		{ const ws = new WebSocket(x)
		ws.onopen = () => yes(ws)
		ws.onerror = () => no(new Error('bad password')) }) }

function msg(type, ...args)
	{ return JSON.stringify([type, ...args])}

async function main()
	{ while (true)
		{ try
			{ const pass = prompt('password?')
			if (!pass) throw 'please actually enter a password'
			document.cookie = `p=${pass}`
			ws = await open_websocket_connection(`ws://${location.hostname}:${location.port}`)
			ws.onmessage = on_message
			chat = qs('aside')
			chat.onmousedown = () => { chat.show() ; document.onmousemove = drag(chat) }
			chat.onmouseup = () => { document.onmousemove = null ; chat.timer.run() }
			chat.timer = new Timed(hide_chat, 2000)
			chat.hide = () => chat.classList.add('opaque')
			chat.show = () => chat.classList.remove('opaque')
			chatlog = qs('section')
			input = qs('input')
			input.addEventListener('focus', () => chat.show())
			input.addEventListener('focusout', () => { if (!document.onmousemove) chat.hide() })
			video = qs('video')
			video.addEventListener('pause', () => ws.send(msg('pause')))
			video.addEventListener('play', () => ws.send(msg('play', video.currentTime)))
			track = qs('video track')
			window.onkeydown = global_key_down
			ws.name = prompt('username?')
			ws.send(msg('name', ws.name))
			chat.timer.run()
			return }
		catch (e)
			{ alert(e) }}}

function hide_chat()
	{ if (document.activeElement !== input && !document.onmousemove)
		chat.hide() }

const drag = x => e =>
	{ console.log('hiiiiiiiii')
	x.style.top = e.clientY-chat.clientHeight*0.5+'px'
	x.style.left = e.clientX-chat.clientWidth*0.5+'px' }

function add_chat_message(x)
	{ chat.show()
	chatlog.appendChild(x)
	chatlog.scrollTop = chatlog.scrollHeight
	chat.timer.run() }

function on_message(message)
	{ const x = JSON.parse(message.data)
	switch (first(x))
		{ case 'notice':
			add_chat_message(
				Elem.of('article').text(second(x)).get())
			break
		case 'chat':
			add_chat_message(
				Elem.of('article')
				.child(Elem.of('strong').colour(colour(second(x))).text(second(x)).get())
				.text(last(x))
				.get())
			break
		case 'pause':
			video.pause()
			break
		case 'play':
			video.currentTime = second(x)
			video.play()
			break
		case 'video':
			video.classList.remove('hide')
			video.src = `/video/${second(x)}`
			track.src = `/video/${second(x)}.vtt`
			break
		case 'ping':
			ws.send(msg('pong')) }}

function global_key_down(e)
	{ if (e.keyCode === 13)
		enter_pressed(e)
	else if (e.keyCode === 112)
		f1_pressed(e)
	return true }

function enter_pressed()
	{ if (document.activeElement !== input) input.focus()
	else
		{ if (input.value.trim())
			{ ws.send(msg('chat', input.value))
			input.value = '' }
		else input.blur() }}

function f1_pressed()
	{ get('/video/').then(x =>
		{ const files = JSON.parse(x)
		const modal = qs('.modal')
		const body = qs('.modal-body')
		const button = qs('.modal > button')
		empty(body)
		const select = Elem.of('select')
			.children(
				files.map(x => Elem.of('option').value(x).text(x).get()))
			.get()
		body.appendChild(select)
		button.onclick = () => {
			ws.send(msg('video', select.value))
			modal.classList.add('hide')
			empty(body) }
		modal.classList.remove('hide') })
	.catch(console.log) }

window.onload = main
