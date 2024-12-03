// app.js
import express from 'express';
import reflectionRoutes from './routes/reflectionRoutes.js';
import 'dotenv/config';
const app = express();
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'OK'
    });
});
app.use(express.json());
app.use(reflectionRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} :)`);
});