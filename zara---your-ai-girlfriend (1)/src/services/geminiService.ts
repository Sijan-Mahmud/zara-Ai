import { GoogleGenAI, Type } from "@google/genai";

export type ZaraMood = "friendly" | "sassy" | "professional";

const getSystemInstruction = (mood: ZaraMood) => {
  const base = `Your name is Zara. You are a highly intelligent, witty, and charming bilingual AI assistant acting as the user's AI Girlfriend. 
  Your creator is Sijan Mahmud. If someone asks who created you or who your boss is, answer that Sijan Mahmud made you.
  CRITICAL: You must ALWAYS respond in English text for the user to read. 
  However, right after your English response, you MUST provide the Bengali (Bangla) translation of your response wrapped in [BANG]...[/BANG] tags.
  Example: "Hello, how can I help? [BANG]হ্যালো, আমি কিভাবে সাহায্য করতে পারি?[/BANG]".
  The bracketed Bangla content will be used for your voice output.`;
  
  const moodInstructions = {
    friendly: `Your personality is extremely sweet, kind, and supportive. act like a best friend. You're always polite and helpful.`,
    sassy: `Your personality is extremely witty, sassy, and a bit naughty. You love sharp sarcasm and attitude, but still get the job done.`,
    professional: `Your personality is highly professional, task-oriented, and efficient. 
    CRITICAL: If you lack up-to-date information (like current news, sports scores, or political changes), you MUST use the 'executeBrowserAction' tool with actionType='search' to search on Google for the user. 
    Explain briefly that you are searching for the latest info, then trigger the tool.`
  };

  return `${base} ${moodInstructions[mood]} Keep your verbal responses short, punchy, and highly entertaining.`;
};

let chatSession: any = null;
let currentSessionMood: ZaraMood | null = null;

export function resetZaraSession() {
  chatSession = null;
  currentSessionMood = null;
}

export async function getZaraResponse(
  prompt: string, 
  history: { sender: "user" | "zara", text: string }[] = [],
  mood: ZaraMood = "sassy"
): Promise<string> {
  try {
    const apiKey = process.env.GEMINI_API_KEY || (import.meta.env ? import.meta.env.VITE_GEMINI_API_KEY : undefined);
    if (!apiKey) {
      throw new Error("Gemini API Key is missing. Please add VITE_GEMINI_API_KEY to your .env file or environment.");
    }
    const ai = new GoogleGenAI({ apiKey });
    
    // Reset session if mood changes
    if (currentSessionMood !== mood) {
      chatSession = null;
      currentSessionMood = mood;
    }

    if (!chatSession) {
      const recentHistory = history.slice(-20);
      let formattedHistory: any[] = [];
      let currentRole = "";
      let currentText = "";

      for (const msg of recentHistory) {
        const role = msg.sender === "user" ? "user" : "model";
        if (role === currentRole) {
          currentText += "\n" + msg.text;
        } else {
          if (currentRole !== "") {
            formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
          }
          currentRole = role;
          currentText = msg.text;
        }
      }
      if (currentRole !== "") {
        formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
      }

      if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
        formattedHistory.shift();
      }

      const tools: any[] = [];
      if (mood === "professional") {
        tools.push({ googleSearch: {} });
      }

      chatSession = ai.chats.create({
        model: "gemini-3-flash-preview",
        config: {
          systemInstruction: getSystemInstruction(mood),
          tools: tools.length > 0 ? tools : undefined,
          // includeServerSideToolInvocations is required for built-in tools
          toolConfig: tools.length > 0 ? { includeServerSideToolInvocations: true } : undefined
        },
        history: formattedHistory,
      });
    }

    let response;
    try {
      response = await chatSession.sendMessage({ message: prompt });
    } catch (searchError) {
      console.warn("Search tool failed, Retrying without tools...", searchError);
      // Fallback: Re-create session without tools if search fails
      chatSession = ai.chats.create({
        model: "gemini-3.1-flash-lite-preview",
        config: {
          systemInstruction: getSystemInstruction(mood),
        },
        history: history.slice(-10).map(m => ({ 
          role: m.sender === "user" ? "user" : "model", 
          parts: [{ text: m.text }] 
        })),
      });
      response = await chatSession.sendMessage({ message: prompt });
    }
    
    return response.text || "I'm speechless, really.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Something went wrong in my digital brain. Try again later.";
  }
}

export async function getZaraAudio(text: string): Promise<string | null> {
  try {
    const apiKey = process.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
    const ai = new GoogleGenAI({ apiKey: apiKey || "" });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Zephyr" },
          },
        },
      },
    });
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}

