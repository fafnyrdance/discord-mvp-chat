const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(__dirname));

const users = {}, servers = {};

io.on('connection', (socket) => {
    socket.on('register user', (data, cb) => {
        users[socket.id] = { id: socket.id, ...data, friends: [], servers: [] };
        cb({ success: true, user: users[socket.id] });
    });

    socket.on('create server', (name, cb) => {
        const id = Math.random().toString(36).substr(2, 6);
        servers[id] = { id, name, channels: ["загальний"] };
        cb({ success: true, server: servers[id] });
    });

    socket.on('chat message', (msg) => {
        io.emit('chat message', { user: users[socket.id]?.username || "Гість", ...msg });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server ready on port ${PORT}`));
