// app.js
import express from "express";
import reflectionRoutes from "./routes/reflectionRoutes.js";
import "dotenv/config";
console.log("FIRST");
const app = express();
app.use(express.json());
app.use(reflectionRoutes);

const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
app.get("/", (req, res) => {
  res.status(200).json({
    status: "OK",
  });
});
