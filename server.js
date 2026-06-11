const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

// Масив для зберігання історії повідомлень в пам'яті сервера
let messagesHistory = [];

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log('Користувач підключився');

    // ХАНДШЕЙК: Щойно користувач підключився, відправляємо йому ВСЮ історію
    socket.emit('load history', messagesHistory);

    socket.on('chat message', (data) => {
        // Формуємо об'єкт повідомлення з часом
        const now = new Date();
        const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const fullMessage = {
            text: data.text || data,
            user: data.user || "Користувач",
            avatar: data.avatar || "U",
            time: timeString
        };

        // Зберігаємо повідомлення в історію на сервері
        messagesHistory.push(fullMessage);

        // Обмежуємо історію, наприклад, останніми 100 повідомленнями, щоб не перевантажувати пам'ять
        if (messagesHistory.length > 100) {
            messagesHistory.shift(); 
        }

        // Розсилаємо це повідомлення всім
        io.emit('chat message', fullMessage);
    });

    socket.on('disconnect', () => {
        console.log('Користувач відключився');
    });
});

http.listen(PORT, () => {
    console.log(`Сервер працює на порту ${PORT}`);
});
