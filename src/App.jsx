import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously
} from "firebase/auth";
import {
  getFirestore,
  collection,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  getDocs,
  query,
  orderBy,
  runTransaction,
  serverTimestamp,
  increment
} from "firebase/firestore";

// =============================
// FIREBASE CONFIG (move to .env)
// =============================
// Replace with env vars (Vite-style). If you use CRA, switch to process.env.REACT_APP_*
const firebaseConfig = {
  apiKey: import.meta?.env?.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta?.env?.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta?.env?.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta?.env?.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta?.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta?.env?.VITE_FIREBASE_APP_ID || ""
};

// =============================
// CONFIG & UTILS
// =============================
const easing = "cubic-bezier(0.86, 0, 0.07, 1)"; // easeInOutQuint

const placeholderFor = (firstName = "?", lastName = "") =>
  `https://placehold.co/150x200/EFEFEF/333?text=${encodeURIComponent(
    `${firstName}`
  )}`;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function computeScoreChange(avgWinnerScore, avgLoserScore, isShutout) {
  // Keep your original flavor but make it deterministic & bounded
  const base = 10;
  const diff = avgLoserScore - avgWinnerScore; // underdog bonus if negative
  let dynamic = Math.round(base + diff / 40);
  dynamic = clamp(dynamic, 1, 20);
  const shutoutBonus = isShutout ? 5 : 0;
  return { winDelta: dynamic + shutoutBonus, loseDelta: dynamic };
}

const winningScoreFor = (team1, team2) => {
  // Deuce at 5:5 -> play to 7, else to 6
  const isDeuce = team1 === 5 && team2 === 5;
  return isDeuce ? 7 : 6;
};

// =============================
// REUSABLE UI
// =============================
const Modal = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 bg-black/75 flex justify-center items-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

const PlayerCard = React.memo(function PlayerCard({ player, onSelect, isSelected }) {
  const { img, firstName, lastName, seasonsWon = 0 } = player || {};
  const src = img || placeholderFor(firstName, lastName);

  return (
    <div
      className={`p-1 transition-colors duration-300 ${
        isSelected ? "bg-[#FF204E]" : "bg-white"
      }`}
      onClick={() => player && onSelect?.(player)}
      role="button"
      aria-label={`${firstName} ${lastName}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect?.(player);
      }}
    >
      <div className="relative bg-gray-500 cursor-pointer aspect-[3/4]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${firstName} ${lastName}`} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

        {seasonsWon > 0 && (
          <div className="absolute top-2 right-2 flex gap-1">
            {Array.from({ length: seasonsWon }).map((_, i) => (
              <svg
                key={i}
                className="w-6 h-6 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
              </svg>
            ))}
          </div>
        )}

        <div className="absolute bottom-0 left-0 p-3 text-white">
          <h3 className="font-normal text-lg leading-tight">{`${firstName} ${lastName}`}</h3>
          <p className="font-light text-base leading-tight">{player?.country}</p>
        </div>
      </div>
    </div>
  );
});

const TeamSelectionSlot = React.memo(function TeamSelectionSlot({
  player,
  role,
  teamName,
  onRemove,
  className = ""
}) {
  return (
    <div
      className={`w-full cursor-pointer ${className}`}
      onClick={() => player && onRemove?.(player)}
      role="button"
      tabIndex={0}
    >
      <p className="text-sm font-light text-white/70">{teamName}</p>
      <div className={`mt-1 p-3 border-[3px] ${player ? "border-white" : "border-white/30"}`}>
        <h4 className="text-xl font-normal">
          {player ? `${player.firstName} ${player.lastName}` : "Spieler auswählen"}
        </h4>
        <p className="text-base font-light text-white/70">{role}</p>
      </div>
    </div>
  );
});

// =============================
// SCREENS
// =============================
function LoginScreen({ onLogin, isExiting }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = useCallback(
    (e) => {
      e.preventDefault();
      setError("");
      const expected = import.meta?.env?.VITE_ADMIN_PASSWORD || ""; // ⚠️ store in .env
      if (password && expected && password === expected) {
        setIsLoggingIn(true);
        setTimeout(() => onLogin?.(), 600);
      } else {
        setError("Falsches Passwort");
        setPassword("");
      }
    },
    [password, onLogin]
  );

  return (
    <div
      className={`absolute inset-0 bg-[#111111] text-white flex flex-col transition-transform duration-1000`}
      style={{ transitionTimingFunction: easing, transform: isExiting ? "translateY(100%)" : "translateY(0)" }}
    >
      <div className="w-full flex-shrink-0">
        <div className="h-[50px] bg-[#25272A]" />
        <div className="h-[50px] bg-[#FF204E]" />
        <div className="h-[50px] bg-[#A0153E]" />
        <div className="h-[50px] bg-[#5D0E41]" />
        <div className="h-[50px] bg-[#00224D]" />
      </div>
      <div className="flex-grow flex flex-col justify-center px-8 md:px-16">
        <h1 className="text-8xl md:text-9xl text-white font-thin tracking-wide mb-12">
          {isLoggingIn ? "LET'S GO!" : "LOGIN"}
        </h1>
        {!isLoggingIn && (
          <form onSubmit={handleLogin} className="w-full max-w-sm flex items-center gap-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="flex-grow px-4 py-3 bg-[#414141] text-white placeholder-gray-400 border-2 border-[#6E6E6E] focus:ring-0 focus:border-white text-lg font-normal"
            />
            <button type="submit" className="px-8 py-3 bg-[#A0153E] text-white text-lg font-normal">
              Send
            </button>
          </form>
        )}
        {error && <p className="text-red-400 mt-4 font-normal">{error}</p>}
      </div>
      <div className="w-full flex justify-between p-4 text-white/50 text-sm font-normal">
        <span>Admin</span>
        <span>V1.1</span>
      </div>
    </div>
  );
}

function PlayerSelectionScreen({ players, onGameStart }) {
  const [slots, setSlots] = useState([null, null, null, null]);

  const handleSelectPlayer = useCallback(
    (player) => {
      setSlots((prev) => {
        const isAlready = prev.some((p) => p && p.id === player.id);
        if (isAlready) return prev.map((p) => (p && p.id === player.id ? null : p));
        const firstEmpty = prev.findIndex((s) => s === null);
        if (firstEmpty === -1) return prev;
        const next = [...prev];
        next[firstEmpty] = player;
        return next;
      });
    },
    []
  );

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.score - a.score),
    [players]
  );

  const team1 = useMemo(
    () => ({ defender: slots[0], forward: slots[1] }),
    [slots]
  );
  const team2 = useMemo(
    () => ({ forward: slots[2], defender: slots[3] }),
    [slots]
  );

  const ready = slots.every((s) => s !== null);
  const start = useCallback(() => ready && onGameStart?.(team1, team2), [ready, onGameStart, team1, team2]);

  return (
    <div className="flex flex-col h-full text-white">
      <div className="flex-grow p-4 md:p-8 overflow-y-auto bg-[#282828]">
        <div className="grid grid-cols-4 gap-4 md:gap-6">
          {sortedPlayers.map((p) => (
            <PlayerCard
              key={p.id}
              player={p}
              onSelect={handleSelectPlayer}
              isSelected={slots.some((s) => s && s.id === p.id)}
            />
          ))}
        </div>
      </div>
      <div className="flex-shrink-0 h-60 bg-[#FF204E] flex items-center justify-center px-4">
        <div className="w-full max-w-4xl flex items-center justify-between">
          <div className="w-2/5 flex flex-col gap-4 relative">
            <TeamSelectionSlot
              player={team1.defender}
              role="Defender"
              teamName="Team 1"
              onRemove={handleSelectPlayer}
              className="w-11/12"
            />
            <TeamSelectionSlot
              player={team1.forward}
              role="Forward"
              teamName=""
              onRemove={handleSelectPlayer}
              className="w-11/12 self-end"
            />
          </div>
          <div className="flex flex-col items-center mx-4">
            <span className="text-4xl font-thin text-white">VS</span>
            {ready && (
              <button onClick={start} className="mt-2 px-4 py-1 bg-white text-black rounded-full">
                Start
              </button>
            )}
          </div>
          <div className="w-2/5 flex flex-col gap-4 relative">
            <TeamSelectionSlot
              player={team2.forward}
              role="Forward"
              teamName="Team 2"
              onRemove={handleSelectPlayer}
              className="w-11/12 self-end"
            />
            <TeamSelectionSlot
              player={team2.defender}
              role="Defender"
              teamName=""
              onRemove={handleSelectPlayer}
              className="w-11/12"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function GameScreen({ initialTeam1, initialTeam2, onGameEnd, onNewGame }) {
  const [team1, setTeam1] = useState({ striker: initialTeam1.forward, defender: initialTeam1.defender });
  const [team2, setTeam2] = useState({ striker: initialTeam2.forward, defender: initialTeam2.defender });
  const [score, setScore] = useState({ team1: 0, team2: 0 });
  const [goalHistory, setGoalHistory] = useState([]);
  const [isSwapped, setIsSwapped] = useState(false);
  const [winner, setWinner] = useState(null);
  const startTimeRef = useRef(Date.now());

  const winningScore = winningScoreFor(score.team1, score.team2);

  useEffect(() => {
    if (!winner && (score.team1 >= winningScore || score.team2 >= winningScore)) {
      setWinner(score.team1 > score.team2 ? "Team 1" : "Team 2");
    }
    if (winner && score.team1 < winningScore && score.team2 < winningScore) {
      setWinner(null); // allow undo after provisional win
    }
  }, [score, winner, winningScore]);

  const handleGoal = useCallback(
    (player, position) => {
      const teamKey = player && (player.id === team1.striker?.id || player.id === team1.defender?.id) ? "team1" : "team2";
      setScore((prev) => ({ ...prev, [teamKey]: prev[teamKey] + 1 }));
      setGoalHistory((prev) => [...prev, { player, position, teamKey }]);
    },
    [team1]
  );

  const handleUndoGoal = useCallback(() => {
    setGoalHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setScore((s) => ({ ...s, [last.teamKey]: Math.max(0, s[last.teamKey] - 1) }));
      return prev.slice(0, -1);
    });
  }, []);

  const swapPositions = useCallback((teamNum) => {
    if (teamNum === 1) setTeam1((prev) => ({ striker: prev.defender, defender: prev.striker }));
    else setTeam2((prev) => ({ striker: prev.defender, defender: prev.striker }));
  }, []);

  const confirmWin = useCallback(() => {
    const duration = Date.now() - startTimeRef.current;
    onGameEnd?.(winner, { team1, team2 }, score, goalHistory, duration);
  }, [winner, team1, team2, score, goalHistory, onGameEnd]);

  const displayTeam1 = isSwapped ? team2 : team1;
  const displayTeam2 = isSwapped ? team1 : team2;
  const displayScore1 = isSwapped ? score.team2 : score.team1;
  const displayScore2 = isSwapped ? score.team1 : score.team2;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col p-4 text-white">
      {winner && (
        <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center z-20">
          <h1 className="text-5xl font-thin text-yellow-400 mb-4">{winner} hat gewonnen!</h1>
          <p className="text-3xl mb-8 font-normal">{score.team1} : {score.team2}</p>
          <div className="flex space-x-4">
            <button onClick={confirmWin} className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-8 text-xl rounded-lg">Ergebnis bestätigen</button>
            <button onClick={onNewGame} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-8 text-xl rounded-lg">Neues Spiel</button>
          </div>
        </div>
      )}

      <div className="flex justify-center items-center mb-6">
        <h2 className="text-2xl font-thin mr-8">Team 1</h2>
        <div className="text-6xl font-bold text-yellow-400">{displayScore1} : {displayScore2}</div>
        <h2 className="text-2xl font-thin ml-8">Team 2</h2>
      </div>
      <p className="text-center text-gray-400 mb-4 font-normal">Das erste Team mit {winningScore} Punkten gewinnt.</p>
      <div className="flex justify-center gap-4 mb-4">
        <button onClick={handleUndoGoal} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg">Tor zurück</button>
        <button onClick={onNewGame} className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg">Spiel abbrechen</button>
      </div>

      <div className="flex-grow flex justify-around items-center">
        <div className="flex flex-col items-center space-y-8">
          <div className="flex space-x-8">
            <PlayerCard player={displayTeam1.striker} onSelect={() => handleGoal(displayTeam1.striker, "striker")} isSelected={false} />
            <PlayerCard player={displayTeam1.defender} onSelect={() => handleGoal(displayTeam1.defender, "defender")} isSelected={false} />
          </div>
          <button onClick={() => swapPositions(isSwapped ? 2 : 1)} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">Positionen tauschen</button>
        </div>

        <button onClick={() => setIsSwapped((s) => !s)} className="bg-purple-600 hover:bg-purple-700 text-white font-bold p-4 rounded-full" aria-label="Seiten tauschen">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
        </button>

        <div className="flex flex-col items-center space-y-8">
          <div className="flex space-x-8">
            <PlayerCard player={displayTeam2.striker} onSelect={() => handleGoal(displayTeam2.striker, "striker")} isSelected={false} />
            <PlayerCard player={displayTeam2.defender} onSelect={() => handleGoal(displayTeam2.defender, "defender")} isSelected={false} />
          </div>
          <button onClick={() => swapPositions(isSwapped ? 1 : 2)} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">Positionen tauschen</button>
        </div>
      </div>
    </div>
  );
}

function PlayerForm({ onSave, player }) {
  const [formData, setFormData] = useState({
    firstName: player?.firstName || "",
    lastName: player?.lastName || "",
    country: player?.country || "",
    img: player?.img || ""
  });

  const isEditing = !!player;

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      if (!formData.firstName || !formData.lastName || !formData.country) {
        alert("Bitte alle Felder ausfüllen.");
        return;
      }
      onSave?.(formData);
    },
    [formData, onSave]
  );

  return (
    <form onSubmit={handleSubmit}>
      <h2 className="text-2xl text-white font-thin mb-6 text-center">{isEditing ? "Spieler bearbeiten" : "Neuen Spieler anlegen"}</h2>
      <div className="mb-4">
        <input type="text" name="firstName" placeholder="Vorname" value={formData.firstName} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md text-white border-2 border-gray-600 focus:outline-none focus:border-yellow-400 font-normal" />
      </div>
      <div className="mb-4">
        <input type="text" name="lastName" placeholder="Nachname" value={formData.lastName} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md text-white border-2 border-gray-600 focus:outline-none focus:border-yellow-400 font-normal" />
      </div>
      <div className="mb-4">
        <input type="text" name="country" placeholder="Landeskürzel (z.B. DE)" value={formData.country} onChange={handleChange} maxLength={3} className="w-full p-3 bg-gray-700 rounded-md text-white border-2 border-gray-600 focus:outline-none focus:border-yellow-400 font-normal" />
      </div>
      <div className="mb-6">
        <input type="text" name="img" placeholder="Bild-URL (optional)" value={formData.img} onChange={handleChange} className="w-full p-3 bg-gray-700 rounded-md text-white border-2 border-gray-600 focus:outline-none focus:border-yellow-400 font-normal" />
      </div>
      <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg text-xl">
        {isEditing ? "Änderungen speichern" : "Spieler hinzufügen"}
      </button>
    </form>
  );
}

const ConfirmationDialog = ({ message, onConfirm, onCancel }) => (
  <div>
    <p className="text-white text-xl text-center mb-8 font-normal">{message}</p>
    <div className="flex justify-center gap-4">
      <button onClick={onConfirm} className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 text-lg rounded-lg">Bestätigen</button>
      <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-8 text-lg rounded-lg">Abbrechen</button>
    </div>
  </div>
);

function ManagePlayersScreen({ players, onAddPlayer, onUpdatePlayer, onDeletePlayer }) {
  const [modalState, setModalState] = useState({ type: null, player: null });

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      const lnA = (a.lastName || "").toLowerCase();
      const lnB = (b.lastName || "").toLowerCase();
      const fnA = (a.firstName || "").toLowerCase();
      const fnB = (b.firstName || "").toLowerCase();
      if (lnA < lnB) return -1;
      if (lnA > lnB) return 1;
      if (fnA < fnB) return -1;
      if (fnA > fnB) return 1;
      return 0;
    });
  }, [players]);

  const handleSavePlayer = useCallback(
    (formData) => {
      if (modalState.type === "add") onAddPlayer?.(formData);
      else if (modalState.type === "edit") onUpdatePlayer?.(modalState.player.id, formData);
      setModalState({ type: null, player: null });
    },
    [modalState, onAddPlayer, onUpdatePlayer]
  );

  const handleDeleteConfirm = useCallback(() => {
    if (modalState.player?.id) onDeletePlayer?.(modalState.player.id);
    setModalState({ type: null, player: null });
  }, [modalState, onDeletePlayer]);

  return (
    <div className="p-4 md:p-8 text-white">
      <Modal isOpen={modalState.type !== null} onClose={() => setModalState({ type: null, player: null })}>
        {(modalState.type === "add" || modalState.type === "edit") && (
          <PlayerForm onSave={handleSavePlayer} player={modalState.player} />
        )}
        {modalState.type === "delete" && (
          <ConfirmationDialog
            message={`Spieler "${modalState.player.firstName} ${modalState.player.lastName}" wirklich löschen?`}
            onConfirm={handleDeleteConfirm}
            onCancel={() => setModalState({ type: null, player: null })}
          />
        )}
      </Modal>

      <div className="flex justify-end items-center mb-6">
        <button onClick={() => setModalState({ type: "add", player: null })} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg">+ Neuer Spieler erstellen</button>
      </div>

      <div className="bg-black/20 rounded-lg shadow-lg overflow-hidden">
        <table className="w-full text-left font-normal">
          <thead className="bg-black/30">
            <tr>
              <th className="p-4">Nachname</th>
              <th className="p-4">Vorname</th>
              <th className="p-4">Land</th>
              <th className="p-4">Bild</th>
              <th className="p-4">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((p) => (
              <tr key={p.id} className="border-b border-white/10 hover:bg-white/5">
                <td className="p-4 cursor-pointer" onClick={() => setModalState({ type: "edit", player: p })}>{p.lastName}</td>
                <td className="p-4 cursor-pointer" onClick={() => setModalState({ type: "edit", player: p })}>{p.firstName}</td>
                <td className="p-4 cursor-pointer" onClick={() => setModalState({ type: "edit", player: p })}>{p.country}</td>
                <td className="p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.img || placeholderFor(p.firstName, p.lastName)} alt={p.firstName} className="w-10 h-12 object-cover rounded-sm" />
                </td>
                <td className="p-4">
                  <button onClick={() => setModalState({ type: "delete", player: p })} className="text-red-500 hover:text-red-400 text-2xl font-bold">&times;</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatisticsScreen({ players, currentSeason, onSeasonClose }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const sorted = useMemo(() => [...players].sort((a, b) => b.score - a.score), [players]);

  return (
    <div className="p-4 md:p-8 text-white">
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <ConfirmationDialog
          message={`Saison ${currentSeason} wirklich schließen? Der Sieger wird ermittelt und die Punktestände werden zurückgesetzt.`}
          onConfirm={() => {
            onSeasonClose?.();
            setIsModalOpen(false);
          }}
          onCancel={() => setIsModalOpen(false)}
        />
      </Modal>

      <div className="flex justify-end items-center mb-8">
        <button onClick={() => setIsModalOpen(true)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg">Saison schließen</button>
      </div>

      <div className="max-w-4xl mx-auto">
        <div className="bg-black/20 rounded-lg shadow-lg">
          {sorted.map((player, i) => (
            <div key={player.id} className={`flex items-center p-4 border-b border-white/10 ${i === 0 ? "bg-yellow-500/20" : ""} cursor-pointer hover:bg-white/5`}>
              <div className="text-2xl font-bold w-12 text-center">{i + 1}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={player.img || placeholderFor(player.firstName, player.lastName)} alt={`${player.firstName} ${player.lastName}`} className="w-12 h-16 object-cover rounded-md mx-4" />
              <div className="flex-grow">
                <h3 className="text-xl font-bold">{`${player.firstName} ${player.lastName}`}</h3>
                <p className="text-sm font-normal">{player.country}</p>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-yellow-400">{player.score}</div>
                <div className="text-sm text-green-400">G: {player.gamesWon || 0}</div>
                <div className="text-sm text-red-400">V: {player.gamesLost || 0}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SaisonsScreen({ history }) {
  const sortedHistory = useMemo(() => [...history].sort((a, b) => b.seasonNumber - a.seasonNumber), [history]);
  return (
    <div className="p-4 md:p-8 text-white">
      <div className="max-w-2xl mx-auto">
        <div className="bg-black/20 rounded-lg shadow-lg">
          <table className="w-full text-left font-normal">
            <thead className="bg-black/30">
              <tr>
                <th className="p-4 text-xl font-normal">Saison</th>
                <th className="p-4 text-xl font-normal">Sieger</th>
              </tr>
            </thead>
            <tbody>
              {sortedHistory.map((s) => (
                <tr key={s.id} className="border-b border-white/10">
                  <td className="p-4 text-lg">Saison {s.seasonNumber}</td>
                  <td className="p-4 text-lg">{s.winnerName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const NavBand = ({ title, bgColors, textColor, isActive, onClick, children }) => (
  <div
    className={`relative w-full overflow-hidden transition-all duration-1000 ease-in-out cursor-pointer flex flex-col flex-shrink-0`}
    style={{ color: textColor, flexBasis: isActive ? "auto" : "75px", flexGrow: isActive ? 1 : 0 }}
    onClick={!isActive ? onClick : undefined}
  >
    <div className="w-full h-full flex flex-col" style={{ background: bgColors.length > 1 ? `linear-gradient(to bottom, ${bgColors[0]} 37.5px, ${bgColors[1]} 37.5px)` : bgColors[0] }}>
      <div className={`absolute top-0 left-0 w-full h-[75px] p-4 px-8 transition-all duration-500 ease-in-out flex items-center ${isActive ? "opacity-0 -translate-y-4" : "opacity-100"}`}>
        <h2 className="text-lg font-light">{title}</h2>
      </div>
      <div className={`absolute top-0 left-0 w-full p-8 transition-all duration-500 ease-in-out ${isActive ? "opacity-100" : "opacity-0 translate-y-4"}`}>
        <h1 className="text-8xl font-thin tracking-wider uppercase">{title}</h1>
      </div>
      <div className={`pt-32 w-full flex-grow overflow-y-auto transition-opacity duration-500 delay-200 ${isActive ? "opacity-100" : "opacity-0"}`}>
        {isActive && children}
      </div>
    </div>
  </div>
);

// =============================
// MAIN APP
// =============================
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [players, setPlayers] = useState([]);
  const [seasonHistory, setSeasonHistory] = useState([]);
  const [appState, setAppState] = useState({ currentSeason: 1 });
  const [db, setDb] = useState(null);
  const [activeView, setActiveView] = useState("new_game");
  const [showLoginTransition, setShowLoginTransition] = useState(false);
  const [isGameActive, setIsGameActive] = useState(false);
  const [gameConfig, setGameConfig] = useState(null);

  // Firebase init
  useEffect(() => {
    if (!firebaseConfig || !firebaseConfig.apiKey) {
      console.warn("Firebase ist nicht konfiguriert (fehlende ENV Vars).");
      return;
    }
    try {
      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const firestore = getFirestore(app);
      setDb(firestore);
      signInAnonymously(auth).catch((err) => console.error("Anonymous sign-in failed:", err));

      // live players
      const unsubPlayers = onSnapshot(collection(firestore, "players"), (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPlayers(data);
      });

      // app state
      const unsubState = onSnapshot(doc(firestore, "appState", "config"), (d) => {
        if (d.exists()) setAppState(d.data());
      });

      // season history
      const unsubHistory = onSnapshot(collection(firestore, "seasonHistory"), (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setSeasonHistory(data);
      });

      return () => {
        unsubPlayers?.();
        unsubState?.();
        unsubHistory?.();
      };
    } catch (e) {
      console.error("Firebase initialization failed:", e);
    }
  }, []);

  const handleLogin = useCallback(() => {
    setShowLoginTransition(true);
    setTimeout(() => setIsLoggedIn(true), 600);
  }, []);

  const handleLogout = useCallback(() => {
    setShowLoginTransition(false);
    setIsLoggedIn(false);
    setActiveView("new_game");
  }, []);

  if (!isLoggedIn) {
    return <LoginScreen onLogin={handleLogin} isExiting={showLoginTransition} />;
  }

  // CRUD: players
  const handleAddPlayer = useCallback(
    async (playerData) => {
      if (!db) return;
      try {
        const newPlayer = {
          ...playerData,
          country: (playerData.country || "").toUpperCase(),
          img: playerData.img || placeholderFor(playerData.firstName, playerData.lastName),
          score: 1500,
          gamesWon: 0,
          gamesLost: 0,
          gamesAsStriker: 0,
          gamesAsDefender: 0,
          totalGames: 0,
          goalsAsStriker: 0,
          goalsAsDefender: 0,
          shutoutWins: 0,
          totalPlaytime: 0
        };
        await addDoc(collection(db, "players"), newPlayer);
      } catch (e) {
        console.error("Error adding player:", e);
      }
    },
    [db]
  );

  const handleUpdatePlayer = useCallback(
    async (playerId, playerData) => {
      if (!db) return;
      try {
        await updateDoc(doc(db, "players", playerId), playerData);
      } catch (e) {
        console.error("Error updating player:", e);
      }
    },
    [db]
  );

  const handleDeletePlayer = useCallback(
    async (playerId) => {
      if (!db) return;
      try {
        await deleteDoc(doc(db, "players", playerId));
      } catch (e) {
        console.error("Error deleting player:", e);
      }
    },
    [db]
  );

  const handleGameStart = useCallback((team1, team2) => {
    setGameConfig({ team1, team2 });
    setIsGameActive(true);
  }, []);

  // =============================
  // ATOMIC MATCH WRITE (transaction)
  // =============================
  const handleGameEnd = useCallback(
    async (winner, teams, score, goalHistory, duration) => {
      if (!db) return;
      const { team1, team2 } = teams;
      const winningTeam = winner === "Team 1" ? team1 : team2;
      const losingTeam = winner === "Team 1" ? team2 : team1;
      const losingTeamScore = winner === "Team 1" ? score.team2 : score.team1;
      const isShutout = losingTeamScore === 0;

      const pRefs = [
        doc(db, "players", team1.striker.id),
        doc(db, "players", team1.defender.id),
        doc(db, "players", team2.striker.id),
        doc(db, "players", team2.defender.id)
      ];

      try {
        await runTransaction(db, async (tx) => {
          const snaps = await Promise.all(pRefs.map((r) => tx.get(r)));
          const [t1s, t1d, t2s, t2d] = snaps.map((s) => ({ id: s.id, ...s.data() }));

          // fresh scores
          const freshTeam1 = { striker: t1s, defender: t1d };
          const freshTeam2 = { striker: t2s, defender: t2d };
          const freshWin = winner === "Team 1" ? freshTeam1 : freshTeam2;
          const freshLose = winner === "Team 1" ? freshTeam2 : freshTeam1;

          const avgWinner = (freshWin.striker.score + freshWin.defender.score) / 2;
          const avgLoser = (freshLose.striker.score + freshLose.defender.score) / 2;
          const { winDelta, loseDelta } = computeScoreChange(avgWinner, avgLoser, isShutout);

          const goalsByPlayer = goalHistory.reduce((acc, g) => {
            const id = g.player?.id;
            if (!id) return acc;
            acc[id] = (acc[id] || 0) + 1;
            return acc;
          }, {});

          const applyStats = (pSnap, didWin, position) => {
            const pid = pSnap.id;
            const goals = goalsByPlayer[pid] || 0;
            const inc = didWin ? winDelta : -loseDelta;
            const common = {
              totalGames: increment(1),
              score: increment(inc),
              totalPlaytime: increment(duration || 0)
            };
            const role = position === "striker" ? {
              gamesAsStriker: increment(1),
              goalsAsStriker: increment(goals)
            } : {
              gamesAsDefender: increment(1),
              goalsAsDefender: increment(goals)
            };
            const wl = didWin ? { gamesWon: increment(1), shutoutWins: isShutout ? increment(1) : increment(0) } : { gamesLost: increment(1) };
            return { ...common, ...role, ...wl };
          };

          // Map roles
          tx.update(pRefs[0], applyStats(snaps[0], winner === "Team 1", "striker"));
          tx.update(pRefs[1], applyStats(snaps[1], winner === "Team 1", "defender"));
          tx.update(pRefs[2], applyStats(snaps[2], winner === "Team 2", "striker"));
          tx.update(pRefs[3], applyStats(snaps[3], winner === "Team 2", "defender"));

          // Store match record
          const matchRef = doc(collection(db, "matches"));
          tx.set(matchRef, {
            createdAt: serverTimestamp(),
            duration,
            score,
            winner,
            teams: {
              team1: {
                striker: { id: team1.striker.id, name: `${team1.striker.firstName} ${team1.striker.lastName}` },
                defender: { id: team1.defender.id, name: `${team1.defender.firstName} ${team1.defender.lastName}` }
              },
              team2: {
                striker: { id: team2.striker.id, name: `${team2.striker.firstName} ${team2.striker.lastName}` },
                defender: { id: team2.defender.id, name: `${team2.defender.firstName} ${team2.defender.lastName}` }
              }
            },
            goals: goalHistory.map((g, i) => ({
              i,
              playerId: g.player?.id,
              position: g.position,
              teamKey: g.teamKey
            }))
          });
        });
      } catch (e) {
        console.error("Error updating player stats after game:", e);
      }

      setIsGameActive(false);
      setActiveView("ranking");
    },
    [db]
  );

  const handleNewGame = useCallback(() => {
    setIsGameActive(false);
    setActiveView("new_game");
  }, []);

  const handleCloseSeason = useCallback(async () => {
    if (!db || players.length === 0) return;
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    const winner = sortedPlayers[0];
    try {
      await addDoc(collection(db, "seasonHistory"), {
        seasonNumber: appState.currentSeason,
        winnerName: `${winner.firstName} ${winner.lastName}`,
        winnerId: winner.id,
        endDate: serverTimestamp()
      });

      await updateDoc(doc(db, "players", winner.id), {
        seasonsWon: (winner.seasonsWon || 0) + 1
      });

      const batch = writeBatch(db);
      const all = await getDocs(query(collection(db, "players")));
      all.forEach((pd) => {
        batch.update(pd.ref, { score: 1500 });
      });
      await batch.commit();

      await updateDoc(doc(db, "appState", "config"), {
        currentSeason: (appState.currentSeason || 1) + 1
      });
    } catch (e) {
      console.error("Error closing season:", e);
    }
  }, [db, players, appState.currentSeason]);

  const navItems = [
    { id: "new_game", title: "New Game", bgColors: ["#282828"], textColor: "white" },
    { id: "ranking", title: "Ranking", bgColors: ["#A0153E"], textColor: "white" },
    { id: "history", title: "History", bgColors: ["#5D0E41"], textColor: "white" },
    { id: "admin", title: "Manage Players", bgColors: ["#00224D"], textColor: "white" }
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@100;300;400;700&display=swap');
        body { font-family: 'Roboto', sans-serif; }
        .font-thin { font-weight: 100 !important; }
        .font-light { font-weight: 300 !important; }
        .font-normal { font-weight: 400 !important; }
        .font-bold { font-weight: 700 !important; }
      `}</style>

      <div className="flex flex-col h-screen w-full overflow-hidden">
        <div className="flex-grow flex flex-col">
          {navItems.map((item) => (
            <NavBand
              key={item.id}
              title={item.title}
              bgColors={item.bgColors}
              textColor={item.textColor}
              isActive={activeView === item.id}
              onClick={() => setActiveView(item.id)}
            >
              {item.id === "new_game" && <PlayerSelectionScreen players={players} onGameStart={handleGameStart} />}
              {item.id === "ranking" && (
                <StatisticsScreen
                  players={players}
                  currentSeason={appState.currentSeason}
                  onSeasonClose={handleCloseSeason}
                />
              )}
              {item.id === "history" && <SaisonsScreen history={seasonHistory} />}
              {item.id === "admin" && (
                <ManagePlayersScreen
                  players={players}
                  onAddPlayer={handleAddPlayer}
                  onUpdatePlayer={handleUpdatePlayer}
                  onDeletePlayer={handleDeletePlayer}
                />
              )}
            </NavBand>
          ))}
        </div>

        <div className="flex-shrink-0 w-full bg-[#00224D] p-4 flex justify-between items-center text-white/50 font-light">
          <div className="flex gap-4">
            <button onClick={handleLogout} className="hover:text-white">Logout</button>
          </div>
          <span>V1.1</span>
        </div>

        {isGameActive && (
          <GameScreen
            initialTeam1={gameConfig.team1}
            initialTeam2={gameConfig.team2}
            onGameEnd={handleGameEnd}
            onNewGame={handleNewGame}
          />
        )}
      </div>
    </>
  );
}
