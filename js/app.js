(() => {
  const app = document.getElementById("app");
  const bg = document.getElementById("bg");
  const content = document.getElementById("content");
  const STORAGE_KEY = "currentSceneId";
  const DEFAULT_PLAYER_NAME = "незнакомка";
  const vkBridge = window.vkBridge || null;
  let vkBridgeInited = window.__vkBridgeInited === true;

  let story = null;
  let currentSceneId = null;
  let currentAudio = null;
  let playerName = DEFAULT_PLAYER_NAME;

  const safeText = (text) => (text || "").replace(/\{\{name\}\}/g, playerName);

  const initPlayerName = async () => {
    if (!vkBridge) return DEFAULT_PLAYER_NAME;
    try {
      if (!vkBridgeInited) {
        await vkBridge.send("VKWebAppInit");
        vkBridgeInited = true;
        window.__vkBridgeInited = true;
      }
      const data = await vkBridge.send("VKWebAppGetUserInfo");
      return data && data.first_name ? data.first_name : DEFAULT_PLAYER_NAME;
    } catch (error) {
      console.warn("VK Bridge get name failed:", error);
      return DEFAULT_PLAYER_NAME;
    }
  };

  const shareScene = async (text) => {
    // Каркас интеграции VK Bridge для шеринга.
    if (!vkBridge) {
      console.log("share:", text);
      return;
    }
    try {
      if (!vkBridgeInited) {
        await vkBridge.send("VKWebAppInit");
        vkBridgeInited = true;
        window.__vkBridgeInited = true;
      }
      await vkBridge.send("VKWebAppShowWallPostBox", {
        message: text,
      });
    } catch (error) {
      console.warn("VK Bridge share failed:", error);
    }
  };

  const preloadBackground = (sceneId) => {
    if (!sceneId || !story || !story.scenes[sceneId]) return;
    const img = new Image();
    img.src = story.scenes[sceneId].background;
  };

  const playAudio = (scene) => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (!scene.audio) return;
    currentAudio = new Audio(scene.audio);
    currentAudio.play().catch(() => {
      // Autoplay may be blocked; ignore.
    });
  };

  const fadeIn = () => {
    app.classList.add("fade");
    // Two rAFs to ensure the browser applies the class before removing it.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        app.classList.remove("fade");
      });
    });
  };

  const setBackground = (scene) => {
    bg.style.backgroundImage = `url('${scene.background}')`;
  };

  const saveProgress = (sceneId) => {
    localStorage.setItem(STORAGE_KEY, sceneId);
  };

  const goTo = (sceneId) => {
    if (!sceneId || !story.scenes[sceneId]) return;
    currentSceneId = sceneId;
    renderScene();
  };

  const createButton = (label, onClick, isPrimary = false) => {
    const btn = document.createElement("button");
    btn.className = `button${isPrimary ? " primary" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return btn;
  };

  const renderScene = (skipDepth = 0) => {
    const scene = story.scenes[currentSceneId];
    if (!scene) return;

    if (scene.type === "share_card") {
      if (skipDepth > 5) {
        console.warn("share_card skip depth exceeded:", scene.id);
        return;
      }
      if (scene.next) {
        currentSceneId = scene.next;
        return renderScene(skipDepth + 1);
      }
      console.warn("share_card without next:", scene.id);
      return;
    }

    saveProgress(currentSceneId);
    setBackground(scene);
    playAudio(scene);

    content.innerHTML = "";

    if (scene.type === "narration") {
      const text = document.createElement("div");
      text.className = "narration";
      text.textContent = safeText(scene.text);
      content.appendChild(text);
    }

    if (scene.type === "message") {
      const bubble = document.createElement("div");
      bubble.className = `bubble ${scene.character === "player" ? "player" : "mark"}`;
      bubble.textContent = safeText(scene.text);
      content.appendChild(bubble);
    }

    if (scene.type === "choice") {
      const actions = document.createElement("div");
      actions.className = "actions";
      scene.choices.forEach((choice) => {
        actions.appendChild(
          createButton(choice.text, () => goTo(choice.next))
        );
      });
      content.appendChild(actions);
    }

    if (scene.type === "ending") {
      const text = document.createElement("div");
      text.className = "narration";
      text.textContent = safeText(scene.text);
      content.appendChild(text);

      const actions = document.createElement("div");
      actions.className = "actions";
      actions.appendChild(
        createButton("Поделиться результатом", () => {
          shareScene(scene.share_text || scene.text);
        })
      );
      actions.appendChild(
        createButton("Начать заново", () => {
          localStorage.removeItem(STORAGE_KEY);
          goTo(story.start);
        }, true)
      );
      content.appendChild(actions);
    }

    if (scene.type !== "choice" && scene.type !== "ending" && scene.type !== "share_card") {
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.appendChild(
        createButton("Далее", () => {
          if (scene.next) goTo(scene.next);
        }, true)
      );
      content.appendChild(actions);
    }

    if (scene.next) {
      preloadBackground(scene.next);
    }

    fadeIn();
  };

  const enableTapToAdvance = () => {
    app.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      const scene = story.scenes[currentSceneId];
      if (!scene) return;
      if (scene.type === "choice" || scene.type === "ending") return;
      if (scene.next) goTo(scene.next);
    });
  };

  const init = async () => {
    const response = await fetch("js/story.json");
    story = await response.json();
    playerName = await initPlayerName();
    const saved = localStorage.getItem(STORAGE_KEY);
    currentSceneId = saved && story.scenes[saved] ? saved : story.start;
    if (saved && !story.scenes[saved]) {
      localStorage.removeItem(STORAGE_KEY);
    }
    enableTapToAdvance();
    renderScene();
  };

  init().catch((err) => {
    console.error("Failed to load story:", err);
  });
})();
