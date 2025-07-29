// app.js
import express from "express";
import reflectionRoutes from "./routes/reflectionRoutes.js";
import agentRecommendationRoutes from "./routes/agentRecommendationRoutes.js";
import "dotenv/config";
console.log("FIRST");
const app = express();
app.use(express.json());
app.use(reflectionRoutes);
app.use("/api/agents", agentRecommendationRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
app.get("/", (req, res) => {
  res.status(200).json({
    status: "OK",
  });
});
