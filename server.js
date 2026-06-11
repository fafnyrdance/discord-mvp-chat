const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

const users = {}, servers = {};

io.on('connection', (socket) => {
    socket.on('register user', (d, cb) => {
        users[socket.id] = { id: socket.id, ...d, avatar: "", customStatus: "", statusType: "online", aboutMe: "", friends: [], servers: [] };
        cb({ success: true, user: users[socket.id] });
        io.emit('update users', users);
    });

    socket.on('update profile', (d) => {
        if(users[socket.id]) { Object.assign(users[socket.id], d); io.emit('update users', users); }
    });

    socket.on('create server', (name, cb) => {
        const id = Math.random().toString(36).substr(2, 6);
        servers[id] = { id, name, owner: socket.id, channels: ["загальний", "флуд"] };
        cb({ success: true, server: servers[id] });
    });

    socket.on('chat message', (m) => {
        io.emit('chat message', { user: users[socket.id]?.username, ...m });
    });

    socket.on('call-user', (d) => io.to(d.toId).emit('incoming-call', d));
});

http.listen(process.env.PORT || 3000);
