const first = x => x[0]
const second = x => x[1]
const last = x => x[x.length-1]
const tail = x => x.slice(1)
const tap = f => x => { f(x) ; return x }
const set = k => v => tap(x => x[k] = v)
const elem = x => document.createElement(x)
const qs = x => document.querySelector(x)
const child = e => tap(x => x.appendChild(e))
const text = x => document.createTextNode(x)
const randint = (a, b) => Math.floor(Math.random()*(b-a) + a)

let ws
let chat
let chatlog
let video
let track
let opaque_timer
let input
const colours = new Map()

function get(x)
    { return new Promise((yes, no) =>
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
        ws.onerror = e => no(new Error('bad password')) }) }

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
            chat = qs('#chat')
            chatlog = qs('#chat > div')
            input = qs ('#chat input')
            input.onmousedown = start_drag
            input.onmouseup = end_drag
            video = qs('video')
            video.addEventListener('pause', () => ws.send(msg('pause')))
            video.addEventListener('play', () => ws.send(msg('play', video.currentTime)))
            track = qs('video track')
            window.onkeydown = global_key_down
            ws.name = prompt('username?')
            ws.send(msg('name', ws.name))
            hide_chat()
            return }
        catch (e)
            { alert(e) }}}

function start_drag()
    { document.onmousemove = drag }

function end_drag()
    { document.onmousemove = null }

function drag(e)
    { chat.style.top = e.clientY-chat.clientHeight*0.95+'px'
    chat.style.left = e.clientX-chat.clientWidth*0.5+'px' }

function hide_chat()
    { clearTimeout(opaque_timer)
    opaque_timer = setTimeout(() => chat.classList.add('opaque'), 1000) }

function add_chat_message(x)
    { chatlog.appendChild(x)
    chat.classList.remove('opaque')
    chatlog.scrollTop = chatlog.scrollHeight
    if (document.activeElement !== input) hide_chat() }

function on_message(message)
    { const x = JSON.parse(message.data)
    switch (first(x))
        { case 'join':
            add_chat_message(
                Elem.of('article').text(`${second(x)} has joined`).get())
            break
        case 'name':
            add_chat_message(
                Elem.of('article').text(`${second(x)} is now known as ${last(x)}`).get())
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

function enter_pressed(e)
    { if (document.activeElement !== input)
        { input.focus()
        chat.classList.remove('opaque')
        clearTimeout(opaque_timer) }
    else
        { if (input.value.trim())
            { ws.send(msg('chat', input.value))
            input.value = '' }
        else
            { input.blur()
            chat.classList.add('opaque') }}}

function f1_pressed(e)
    { get('/video').then(x =>
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