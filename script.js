(function () {
	"use strict";

	/**
	 * App state
	 */
	const state = {
		clues: [],
		idx: 0,
		current: null,
		answerStripped: "",
		letters: [],
		partMappings: [],
		helpUsed: false,
		analyseUsed: false,
		plainClueMode: false,
		activeIdx: 0,
		menuOpen: false
	};

	let cluesPromise = null;

	/**
	 * DOM
	 */
	const $welcome = document.getElementById("welcome");
	const $game = document.getElementById("game");
	const $play = document.getElementById("playBtn");
	const $clueLine = document.getElementById("clueLine");
	const $answerContainer = document.getElementById("answerContainer");
	const $submit = document.getElementById("submitBtn");
	const $hintsBtn = document.getElementById("hintsBtn");
	const $hintsMenu = document.getElementById("hintsMenu");
	const $revealDef = document.getElementById("revealDef");
	const $revealLetter = document.getElementById("revealLetter");
	const $revealStruct = document.getElementById("revealStruct");
	const $changeClue = document.getElementById("changeClue");
	const $mobileInput = document.getElementById("mobileInput");
	const $fireworks = document.getElementById("fireworks");

	/**
	 * Init
	 */
	window.addEventListener("DOMContentLoaded", () => {
		wireEvents();
		cluesPromise = fetch("clues.json")
			.then(r => r.json())
			.then(data => {
				state.clues = Array.isArray(data?.clues) ? data.clues : [];
			})
			.catch(() => {
				state.clues = [];
			});
	});

	function wireEvents() {
		if ($play) {
			$play.addEventListener("click", async () => {
				try { await (cluesPromise || Promise.resolve()); } catch(_) {}
				startGame();
			});
		}
		if ($submit) {
			$submit.addEventListener("click", onSubmit);
		}
		if ($hintsBtn) {
			$hintsBtn.addEventListener("click", toggleMenu);
		}
		if ($revealDef) {
			$revealDef.addEventListener("click", onRevealDefinition);
		}
		if ($revealLetter) {
			$revealLetter.addEventListener("click", onRevealLetter);
		}
		if ($revealStruct) {
			$revealStruct.addEventListener("click", onRevealStructure);
		}
		if ($changeClue) {
			$changeClue.addEventListener("click", onChangeClue);
		}

		// Close dropdown on outside click or Esc
		document.addEventListener("click", (e) => {
			if (!state.menuOpen) return;
			const t = e.target;
			if (!($hintsMenu?.contains(t) || $hintsBtn?.contains(t))) {
				closeMenu();
			}
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") closeMenu();
		});

		// Keyboard input
		document.addEventListener("keydown", handleKey);
	}

	function startGame() {
		$welcome?.classList.add("hidden");
		$game?.classList.remove("hidden");
		// Safe focus for mobile keyboard
		try { $mobileInput?.focus(); } catch (_) {}
		state.idx = 0;
		loadClue(state.idx);
	}

	function loadClue(index) {
		state.current = state.clues[index] || null;
		resetHintFlags();
		if (!state.current) {
			endWithFireworks();
			return;
		}

		const answerStripped = (state.current.answer || "").replace(/\s+/g, "").toUpperCase();
		state.answerStripped = answerStripped;
		state.letters = new Array(answerStripped.length).fill("");
		state.activeIdx = 0;
		state.partMappings = computePartMappings(state.current, answerStripped);

		renderClueLine(state.current);
		renderAnswerSquares(state.current.answer || "");
		updateActiveSquare(0);
		closeMenu();
	}

	function resetHintFlags() {
		state.helpUsed = false;
		state.analyseUsed = false;
		state.plainClueMode = false;
		$revealDef?.classList.remove("disabled");
		$revealDef?.removeAttribute("disabled");
		$revealStruct?.classList.remove("disabled");
		$revealStruct?.removeAttribute("disabled");
		$changeClue?.classList.remove("disabled");
		$changeClue?.removeAttribute("disabled");
	}

	function getIndicatorTooltipByType(type) {
		switch ((type || "").toLowerCase()) {
			case "anagram": return "Anagram — shuffle the letters in the fodder.";
			case "hidden": return "Hidden — look inside the fodder.";
			case "container": return "Container — insert one part into another.";
			case "reversal": return "Reversal — read backwards.";
			case "deletion": return "Deletion — remove letters.";
			case "homophone": return "Homophone — sounds like.";
			case "acrostic": return "Acrostic — take first letters.";
			case "spoonerism": return "Spoonerism — swap starting sounds.";
			case "charade": return "Charade — build the answer in parts.";
			case "double": return "Double definition — two meanings, one word.";
			case "lit": return "&lit — whole clue is definition and wordplay.";
			default: return "Indicator";
		}
	}

	function renderClueLine(clue) {
		const typeClass = (clue?.clueType || "").toLowerCase();
		$clueLine?.classList.remove(
			"anagram","hidden","container","reversal","deletion","homophone","acrostic","spoonerism","charade","double","lit","annot-on","help-on"
		);
		if (typeClass) $clueLine?.classList.add(typeClass);

		if (state.plainClueMode) {
			if ($clueLine) $clueLine.textContent = clue?.normalClue || clue?.clue || "";
			return;
		}

		const html = buildAnnotatedClueHTML(clue);
		if ($clueLine) {
			$clueLine.innerHTML = html;
			$clueLine.classList.remove("annot-on","help-on");
		}

		// Attach mapping hover/touch handlers on fodder spans
		setTimeout(() => {
			const fodders = $clueLine?.querySelectorAll?.(".fodder[data-part]") || [];
			fodders.forEach(el => {
				el.addEventListener("mouseenter", onFodderEnter);
				el.addEventListener("mouseleave", clearMappedSquares);
				el.addEventListener("touchstart", onFodderTouch, { passive: true });
			});
		}, 0);
	}

	function buildAnnotatedClueHTML(clue) {
		const raw = clue?.clue || "";
		const lower = raw.toLowerCase();
		const ranges = [];

		function claimRange(start, end, cls, tip, extraAttrs) {
			if (start < 0 || end < 0 || end < start) return false;
			for (let r of ranges) {
				if (!(end < r.start || start > r.end)) return false; // overlap
			}
			ranges.push({ start, end, cls, tip, extraAttrs: extraAttrs || {} });
			return true;
		}

		function findAndClaim(token, cls, tip, extraAttrs) {
			if (!token) return;
			const t = token.toLowerCase();
			let idx = lower.indexOf(t);
			while (idx !== -1) {
				const ok = claimRange(idx, idx + t.length - 1, cls, tip, extraAttrs);
				if (ok) break; else idx = lower.indexOf(t, idx + 1);
			}
		}

		// Definitions
		if ((clue?.clueType || "").toLowerCase() === "double" && Array.isArray(clue?.definitions) && clue.definitions.length >= 2) {
			findAndClaim(clue.definitions[0], "def def-0", "Double definition — meaning 1");
			findAndClaim(clue.definitions[1], "def def-1", "Double definition — meaning 2");
		} else if (Array.isArray(clue?.definitionWords)) {
			for (const tok of clue.definitionWords) {
				findAndClaim(tok, "def", "Definition — what the answer means.");
			}
		}

		// Indicators
		if (Array.isArray(clue?.indicatorWords)) {
			const tip = getIndicatorTooltipByType(clue?.clueType);
			for (const tok of clue.indicatorWords) {
				findAndClaim(tok, "indicator", tip);
			}
		}

		// Fodder spans (data-part index)
		if (Array.isArray(clue?.fodderWords)) {
			for (let i = 0; i < clue.fodderWords.length; i++) {
				const tok = clue.fodderWords[i];
				const hint = Array.isArray(clue?.parts) && clue.parts[i]?.hint ? clue.parts[i].hint : "Fodder — used to build the answer.";
				findAndClaim(tok, "fodder", hint, { "data-part": String(i) });
			}
		}

		ranges.sort((a, b) => a.start - b.start);
		let html = "";
		let pos = 0;
		for (const r of ranges) {
			if (pos < r.start) html += escapeHTML(raw.slice(pos, r.start));
			const attrs = Object.entries(r.extraAttrs || {}).map(([k, v]) => `${k}="${escapeHTML(String(v))}"`).join(" ");
			const tipAttr = r.tip ? ` data-tip="${escapeHTML(r.tip)}"` : "";
			html += `<span class="${r.cls}"${tipAttr}${attrs ? " " + attrs : ""}>${escapeHTML(raw.slice(r.start, r.end + 1))}</span>`;
			pos = r.end + 1;
		}
		if (pos < raw.length) html += escapeHTML(raw.slice(pos));
		return html;
	}

	function escapeHTML(s) {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
	}

	function renderAnswerSquares(answerWithSpaces) {
		if (!$answerContainer) return;
		$answerContainer.innerHTML = "";
		const answer = (answerWithSpaces || "").toUpperCase();
		const words = answer.split(/\s+/g);
		const $answer = document.createElement("div");
		$answer.className = "answer";
		let globalIndex = 0;
		for (const w of words) {
			const $word = document.createElement("div");
			$word.className = "answer-word";
			for (let i = 0; i < w.length; i++) {
				const $sq = document.createElement("div");
				$sq.className = "square";
				$sq.setAttribute("data-idx", String(globalIndex));
				$sq.setAttribute("tabindex", "0");
				$sq.addEventListener("click", () => updateActiveSquare(globalIndex));
				$word.appendChild($sq);
				globalIndex++;
			}
			$answer.appendChild($word);
		}
		$answerContainer.appendChild($answer);
	}

	function onFodderEnter(e) {
		const part = Number(e.currentTarget?.getAttribute?.("data-part"));
		if (Number.isNaN(part)) return;
		applyMappedSquares(part);
	}
	function onFodderTouch(e) {
		const part = Number(e.currentTarget?.getAttribute?.("data-part"));
		if (Number.isNaN(part)) return;
		applyMappedSquares(part);
		setTimeout(clearMappedSquares, 650);
	}

	function applyMappedSquares(partIndex) {
		const indices = state.partMappings[partIndex] || [];
		const squares = $answerContainer?.querySelectorAll?.(".square") || [];
		indices.forEach(i => {
			const sq = squares[i];
			if (sq) sq.classList.add("mapped");
		});
	}
	function clearMappedSquares() {
		const squares = $answerContainer?.querySelectorAll?.(".square.mapped") || [];
		squares.forEach(sq => sq.classList.remove("mapped"));
	}

	function computePartMappings(clue, answerStripped) {
		const claimed = new Set();
		const mappings = [];
		const parts = Array.isArray(clue?.parts) ? clue.parts : [];
		for (let i = 0; i < parts.length; i++) {
			const p = parts[i] || {};
			let indices = [];
			if (Array.isArray(p.indices) && p.indices.length > 0) {
				indices = p.indices.filter(n => Number.isInteger(n) && n >= 0 && n < answerStripped.length);
			} else if (Array.isArray(p.range) && p.range.length === 2) {
				const [a, b] = p.range;
				const start = Math.max(0, Math.min(a, b));
				const end = Math.min(answerStripped.length - 1, Math.max(a, b));
				for (let j = start; j <= end; j++) indices.push(j);
			} else if (typeof p.yields === "string" && p.yields.length > 0) {
				const y = p.yields.toUpperCase();
				const N = answerStripped.length;
				const L = y.length;
				let placed = false;
				for (let pos = 0; pos <= N - L; pos++) {
					let ok = true;
					for (let k = 0; k < L; k++) {
						if (claimed.has(pos + k) || answerStripped[pos + k] !== y[k]) { ok = false; break; }
					}
					if (ok) {
						for (let k = 0; k < L; k++) indices.push(pos + k);
						placed = true; break;
					}
				}
				if (!placed) indices = [];
			}
			indices.forEach(n => claimed.add(n));
			mappings.push(indices);
		}
		return mappings;
	}

	function updateActiveSquare(nextIdx) {
		const squares = $answerContainer?.querySelectorAll?.(".square") || [];
		if (!squares.length) return;
		const bounded = Math.max(0, Math.min(nextIdx, squares.length - 1));
		state.activeIdx = bounded;
		squares.forEach(sq => sq.classList.remove("active"));
		const active = squares[bounded];
		if (active) active.classList.add("active");
	}

	function handleKey(e) {
		if ($game?.classList.contains("hidden")) return;
		const squares = $answerContainer?.querySelectorAll?.(".square") || [];
		if (!squares.length) return;
		const idx = state.activeIdx || 0;
		if (e.key === "Enter") { onSubmit(); return; }
		if (e.key === "Backspace") {
			e.preventDefault();
			fillSquare(idx, "");
			updateActiveSquare(Math.max(0, idx - 1));
			return;
		}
		const isLetter = /^[a-z]$/i.test(e.key || "");
		if (isLetter) {
			e.preventDefault();
			fillSquare(idx, (e.key || "").toUpperCase());
			if (idx < squares.length - 1) updateActiveSquare(idx + 1);
		}
	}

	function fillSquare(idx, char) {
		const squares = $answerContainer?.querySelectorAll?.(".square") || [];
		const sq = squares[idx];
		if (!sq) return;
		sq.textContent = char || "";
		state.letters[idx] = char || "";
	}

	function onSubmit() {
		const guess = (state.letters || []).join("");
		if (!guess) return wrong();
		if (guess === state.answerStripped) {
			correct();
		} else {
			wrong();
		}
	}

	function correct() {
		$game?.classList.add("flash-green");
		setTimeout(() => {
			$game?.classList.remove("flash-green");
			advance();
		}, 2000);
	}
	function wrong() {
		$game?.classList.add("flash-red");
		setTimeout(() => $game?.classList.remove("flash-red"), 600);
	}
	function advance() {
		if (state.idx + 1 >= state.clues.length) {
			endWithFireworks();
			return;
		}
		state.idx += 1;
		loadClue(state.idx);
	}

	function onRevealDefinition() {
		if (state.plainClueMode) return;
		$clueLine?.classList.add("help-on");
		if ($clueLine?.classList.contains("double")) {
			$clueLine.classList.add("help-on", "double");
		}
		state.helpUsed = true;
		disableOnce($revealDef);
	}
	function onRevealStructure() {
		if (state.plainClueMode) return;
		$clueLine?.classList.add("annot-on");
		state.analyseUsed = true;
		disableOnce($revealStruct);
	}
	function onRevealLetter() {
		const empties = [];
		for (let i = 0; i < state.letters.length; i++) if (!state.letters[i]) empties.push(i);
		if (!empties.length) return; // nothing to reveal
		const emptyIdx = empties[Math.floor(Math.random() * empties.length)];
		const correctChar = state.answerStripped[emptyIdx];
		fillSquare(emptyIdx, correctChar);
		updateActiveSquare(Math.min(emptyIdx + 1, state.letters.length - 1));
	}
	function onChangeClue() {
		state.plainClueMode = true;
		renderClueLine(state.current);
		// Disable Definition and Analyse for this clue only
		disableOnce($changeClue);
		disableOnce($revealDef);
		disableOnce($revealStruct);
	}

	function disableOnce(btn) {
		btn?.classList.add("disabled");
		btn?.setAttribute?.("disabled", "true");
	}

	function toggleMenu() {
		if ($hintsMenu?.classList.contains("hidden")) openMenu(); else closeMenu();
	}
	function openMenu() {
		$hintsMenu?.classList.remove("hidden");
		$hintsMenu?.setAttribute?.("aria-hidden", "false");
		state.menuOpen = true;
	}
	function closeMenu() {
		$hintsMenu?.classList.add("hidden");
		$hintsMenu?.setAttribute?.("aria-hidden", "true");
		state.menuOpen = false;
	}

	function endWithFireworks() {
		$clueLine?.parentElement?.classList.add("hidden");
		$answerContainer?.classList.add("hidden");
		$submit?.classList.add("hidden");
		$hintsBtn?.parentElement?.classList.add("hidden");
		$fireworks?.classList.remove("hidden");
		startFireworks($fireworks);
	}

	// Minimal fireworks pixels animation on canvas
	function startFireworks(canvas) {
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		function resize() {
			canvas.width = window.innerWidth; canvas.height = window.innerHeight;
		}
		resize();
		window.addEventListener("resize", resize);

		const particles = [];
		function boom() {
			const x = Math.random() * canvas.width;
			const y = Math.random() * canvas.height * 0.5 + canvas.height * 0.1;
			const count = 60;
			for (let i = 0; i < count; i++) {
				const angle = (Math.PI * 2 * i) / count;
				particles.push({
					x,
					y,
					vx: Math.cos(angle) * (Math.random() * 3 + 1.5),
					vy: Math.sin(angle) * (Math.random() * 3 + 1.5),
					life: 60 + Math.random() * 30,
					color: `hsl(${Math.floor(Math.random() * 360)}, 100%, 70%)`
				});
			}
		}

		let lastTime = 0;
		function tick(ts) {
			if (ts - lastTime > 700) { boom(); lastTime = ts; }
			ctx.fillStyle = "rgba(0,0,0,0.25)";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			for (let i = particles.length - 1; i >= 0; i--) {
				const p = particles[i];
				p.x += p.vx; p.y += p.vy; p.vy += 0.02; p.life -= 1;
				ctx.fillStyle = p.color;
				ctx.fillRect(p.x, p.y, 2, 2);
				if (p.life <= 0) particles.splice(i, 1);
			}
			requestAnimationFrame(tick);
		}
		requestAnimationFrame(tick);
	}
})();