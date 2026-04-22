import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, Heart, Zap, Briefcase, Bot, Sparkles } from "lucide-react";
import { getZaraResponse, getZaraAudio, resetZaraSession, ZaraMood } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import { playPCM } from "./utils/audioUtils";
import { motion, AnimatePresence } from "motion/react";

type AppState = "idle" | "listening" | "processing" | "speaking";

interface ChatMessage {
  id: string;
  sender: "user" | "zara";
  text: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [mood, setMood] = useState<ZaraMood>(() => {
    return (localStorage.getItem("zara_mood") as ZaraMood) || "sassy";
  });
  
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem("zara_chat_history");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error("Failed to parse chat history", e);
      }
    }
    return [];
  });
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
    localStorage.setItem("zara_chat_history", JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem("zara_mood", mood);
  }, [mood]);

  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, appState]);

  const handleTextCommand = useCallback(async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      setAppState("idle");
      return;
    }

    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "user", text: finalTranscript }]);
    
    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      liveSessionRef.current.sendText(finalTranscript);
      return;
    }

    setAppState("processing");

    // 1. Check for browser commands
    const commandResult = processCommand(finalTranscript);

    let responseText = "";

    if (commandResult.isBrowserAction) {
      responseText = commandResult.action;
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "zara", text: responseText }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZaraAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }

      setAppState("idle");

      setTimeout(() => {
        if (commandResult.url) {
          window.open(commandResult.url, "_blank");
        }
      }, 1500);
    } else {
      // 2. General Chit-Chat via Gemini
      const rawResponse = await getZaraResponse(finalTranscript, messagesRef.current, mood);
      
      // Parse English text and Bangla audio tag
      const bangMatch = rawResponse.match(/\[BANG\](.*?)\[\/BANG\]/s);
      const audioText = bangMatch ? bangMatch[1].trim() : rawResponse;
      const displayText = rawResponse.replace(/\[BANG\].*?\[\/BANG\]/gs, "").trim();

      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "zara", text: displayText }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZaraAudio(audioText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }
      setAppState("idle");
    }
  }, [isMuted, isSessionActive, mood]);

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = async () => {
    if (isSessionActive) {
      setIsSessionActive(false);
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
        liveSessionRef.current = null;
      }
      setAppState("idle");
      resetZaraSession();
    } else {
      try {
        setIsSessionActive(true);
        resetZaraSession();
        
        const session = new LiveSessionManager();
        session.isMuted = isMuted;
        session.mood = mood;
        liveSessionRef.current = session;
        
        session.onStateChange = (state) => {
          setAppState(state);
        };
        
        session.onMessage = (sender, text) => {
          setMessages((prev) => [...prev, { id: Date.now().toString() + "-" + sender, sender, text }]);
        };
        
        session.onCommand = (url) => {
          setTimeout(() => {
            window.open(url, "_blank");
          }, 1000);
        };

        await session.start();
      } catch (e) {
        console.error("Failed to start session", e);
        setShowPermissionModal(true);
        setIsSessionActive(false);
        setAppState("idle");
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    
    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0">
      {showPermissionModal && (
        <PermissionModal 
          onClose={() => setShowPermissionModal(false)} 
        />
      )}

      {/* Cinematic Background Gradients */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-900/20 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-center z-20 shrink-0 px-6 py-4 md:px-12 md:py-6 bg-gradient-to-b from-black/50 to-transparent">
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 rounded-2xl bg-black/20 flex items-center justify-center shadow-xl border border-white/10 overflow-hidden group">
            <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <img 
              src="/zara-logo.png" 
              alt="Zara Logo" 
              className="w-full h-full object-cover relative z-10"
              referrerPolicy="no-referrer"
              onError={(e) => {
                // Fallback to bot icon if image fails to load
                e.currentTarget.style.display = 'none';
                e.currentTarget.parentElement?.querySelector('.fallback-bot')?.classList.remove('hidden');
              }}
            />
            <div className="fallback-bot hidden relative z-10">
              <Bot size={24} className="text-white drop-shadow-md" />
            </div>
            <Sparkles size={12} className="absolute top-1 right-1 text-yellow-200 animate-pulse z-20" />
          </div>
          <div>
            <h1 className="text-xl font-sans font-bold tracking-tight opacity-90">Zara</h1>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold">AI Girlfriend</div>
          </div>
        </div>

        {/* Mood Selector */}
        <div className="hidden sm:flex items-center bg-white/5 border border-white/10 rounded-full p-1 self-center">
          {[
            { id: 'friendly', icon: Heart, label: 'Friendly', color: 'hover:text-pink-400' },
            { id: 'sassy', icon: Zap, label: 'Sassy', color: 'hover:text-yellow-400' },
            { id: 'professional', icon: Briefcase, label: 'Pro', color: 'hover:text-cyan-400' }
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => setMood(m.id as ZaraMood)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
                mood === m.id 
                  ? "bg-white/10 text-white shadow-inner shadow-white/5" 
                  : `text-white/40 ${m.color}`
              }`}
            >
              <m.icon size={14} />
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={() => {
                setMessages([]);
                resetZaraSession();
                // If there's an active live session, it has its own internal state, 
                // but resetting Zara session will affect the next text-based turn.
              }}
              className="p-2.5 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 transition-colors border border-white/10"
              title="Clear Chat History"
            >
              <Trash2 size={18} className="opacity-70" />
            </button>
          )}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-2.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX size={18} className="opacity-70" />
            ) : (
              <Volume2 size={18} className="opacity-70" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile Mood Selector */}
      <div className="sm:hidden absolute top-24 left-1/2 -translate-x-1/2 z-20 flex items-center bg-black/40 backdrop-blur-md border border-white/10 rounded-full p-1">
        {[
          { id: 'friendly', icon: Heart },
          { id: 'sassy', icon: Zap },
          { id: 'professional', icon: Briefcase }
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => setMood(m.id as ZaraMood)}
            className={`p-2 rounded-full transition-all ${
              mood === m.id ? "bg-white/20 text-white" : "text-white/40"
            }`}
          >
            <m.icon size={18} />
          </button>
        ))}
      </div>

      {/* Main Content - Visualizer & Chat */}
      <main className="flex-1 flex flex-row items-center justify-between w-full z-10 overflow-hidden pt-32 pb-40 px-4 md:px-12 pointer-events-none">
        
        {/* Left Column: Zara Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6">
            <AnimatePresence>
              {appState === "processing" && (
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-2 text-cyan-300/80 text-sm md:text-base italic font-serif"
                >
                  <Loader2 size={16} className="animate-spin" />
                  Thinking...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Center Visualizer */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
          <Visualizer state={appState} />
        </div>

        {/* Right Column: User Status */}
        <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
          <div className="h-6 flex justify-end">
            <AnimatePresence>
              {appState === "listening" && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-2 text-violet-300/80 text-sm md:text-base italic"
                >
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                  Listening...
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

      </main>

      {/* Messages Feed (Center Bottom) */}
      <div className="absolute bottom-44 left-1/2 -translate-x-1/2 w-full max-w-2xl px-6 pointer-events-none z-10 flex flex-col gap-3">
        <div className="flex flex-col gap-2 overflow-y-auto scrollbar-hide max-h-[30vh] pointer-events-auto">
          {messages.slice(-3).map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-3 rounded-2xl max-w-[85%] text-sm ${
                msg.sender === "user" 
                  ? "bg-violet-500/20 border border-violet-500/30 self-end text-right rounded-tr-none" 
                  : "bg-white/5 border border-white/10 self-start rounded-tl-none text-white/90"
              }`}
            >
              {msg.text}
            </motion.div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Controls */}
      <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-8 md:pb-12 z-20 shrink-0 gap-4">
        <AnimatePresence>
          {showTextInput && (
            <motion.form 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onSubmit={handleTextSubmit}
              className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md shadow-2xl"
            >
              <input 
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={`Type a message to Zara (${mood})...`}
                className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
                autoFocus
              />
              <button 
                type="submit"
                disabled={!textInput.trim()}
                className="p-2.5 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 transition-colors shadow-lg"
              >
                <Send size={16} />
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-6">
          <button
            onClick={toggleListening}
            className={`
              group relative flex items-center gap-3 px-10 py-5 rounded-full font-medium tracking-wide transition-all duration-300 shadow-[0_0_40px_rgba(139,92,246,0.3)]
              ${
                isSessionActive
                  ? "bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                  : "bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105"
              }
            `}
          >
            {isSessionActive ? (
              <>
                <MicOff size={22} />
                <span>End Session</span>
              </>
            ) : (
              <>
                <div className="absolute -inset-1 bg-gradient-to-r from-violet-500/20 to-pink-500/20 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                <Mic size={22} className="relative group-hover:scale-110 transition-transform" />
                <span className="relative">Start Zara</span>
              </>
            )}
          </button>
          
          {!isSessionActive && (
            <button
              onClick={() => setShowTextInput(!showTextInput)}
              className="p-5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors shadow-2xl group"
              title="Type instead"
            >
              <Keyboard size={22} className="opacity-70 group-hover:scale-110 transition-transform" />
            </button>
          )}
        </div>

        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-white/20 uppercase tracking-[0.3em] font-medium whitespace-nowrap">
          Created by Sijan Mahmud
        </div>
      </footer>
    </div>
  );
}
