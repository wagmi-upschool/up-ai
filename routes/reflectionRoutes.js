// routes/reflectionRoutes.js
import express from "express";
import {
  // handleReflection,
  handleReflectionStream,
} from "../controllers/reflectionController.js";
import { handleWhatToAskController } from "../controllers/whatToAskController.js";
import { handleAddDocumentsToAssistantDocuments } from "../controllers/uploadDocuments.js";
import { handleLLMStream } from "../controllers/chatController.js";
const router = express.Router();
// router.post(
//   "/user/:userId/conversation/:conversationId/reflection",
//   handleReflection
// );
router.post(
  "/user/:userId/conversation/:conversationId/reflection/stream",
  handleReflectionStream
);
router.post(
  "/user/:userId/conversation/:conversationId/whatToAsk/stream",
  handleWhatToAskController
);
router.post(
  "/user/:userId/conversation/:conversationId/chat/stream",
  handleLLMStream
);
router.post(
  "/assistant/:assistantId/documents",
  handleAddDocumentsToAssistantDocuments
);

export default router; // Change this to a default export
