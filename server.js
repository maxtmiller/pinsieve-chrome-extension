import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function callOpenAI(messages, systemPrompt, maxTokens = 1024) {
  if (!Array.isArray(messages)) {
    throw new Error("messages must be an array");
  }

  const normalizedMessages = messages.map(m => {
    if (typeof m === "string") {
      return { role: "user", content: m };
    }

    if (typeof m === "object" && m.role && m.content) {
      return m;
    }

    throw new Error("Invalid message format");
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      ...normalizedMessages
    ],
    max_tokens: maxTokens
  });

  return response.choices[0].message.content;
}

app.post("/api/claude", async (req, res) => {
  try {
    const { messages, systemPrompt, maxTokens } = req.body;

    console.log("Messages received for OpenAI:", JSON.stringify(messages, null, 2));
    console.log("System prompt:", systemPrompt);
    console.log("Max tokens:", maxTokens);

    const result = await callOpenAI(
      messages,
      systemPrompt,
      maxTokens
    );

    throw new Error('This is a forced error');

    res.json({ text: result });
    console.log("[PinGift] Generated gift ideas from OpenAI");
    console.log(result);
  } catch (err) {
    console.error("OpenAI error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});