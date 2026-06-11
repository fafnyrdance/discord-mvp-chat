const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// Спрощена логіка для перевірки працездатності
io.on('connection', (socket) => {
    console.log('Користувач підключився');
    // Тут буде вся інша логіка з попередніх повідомлень
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Сервер запущено на порту ${PORT}`));
