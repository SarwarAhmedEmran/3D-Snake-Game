# 🐍 Snake 3D – A Modern Take on the Classic Game
A reimagined 3D version of the classic Snake game built with HTML, CSS, and JavaScript (Three.js).


## ✨ Features

- 🎮 **Gameplay**
  - Multiple handcrafted levels with unique layouts (mazes, corridors, pillars, rings, etc.)
  - Classic Snake mechanics with twists: wrapping, obstacles, and different difficulty modes
  - Food types:
    - Normal 🍎 (+1 point)
    - Golden ⭐ (+3 points, expires in 8s)
    - Poison ☠ (−2 points, shrinks snake, expires in 4s)

- 🎨 **Visuals & Effects**
  - Realistic **3D snake body** with spline-based animation and skin textures
  - Custom **ground textures** and HDR environment lighting
  - Smooth **camera follow system** (toggleable with `C`)
  - Particle effects for eating, level-ups, and collisions

- 🔊 **Audio**
  - Background music 🎵
  - Sound effects for eating, leveling, and game-over
  - Adjustable volume, mute toggle, and audio settings

- ⚙️ **UI & UX**
  - Start Menu with **Play / How To / Highscores / Settings**
  - HUD overlay showing **score, level, and timer**
  - Countdown before each level
  - Pause Menu & Game Over overlays
  - Persistent **leaderboard with top 10 scores** (saved in localStorage)

---

## 📂 Project Structure

3D-Snake-Game/
│── index.html # Main entry point (UI overlays + canvas)
│── style.css # Styling for UI, HUD, and menus
│── game.js # Game logic and rendering
│── textures/ # Game textures
│ ├── bg.jpg # Ground texture
│ ├── snake_diffuse.jpg # Snake skin (color)
│ ├── snake_normal.jpg # Snake skin (normal mapping)
│ ├── snake_rough.jpg # Snake skin (roughness map)
│ ├── snake_ao.jpg # Snake skin (AO/shadows)
│ └── env.hdr # HDR lighting (optional)
│── sounds/ # Audio assets (bgm + sound effects)
│── README.md # Project documentation


##  Live Demo

▶ [Play the Game Here](https://SarwarAhmedEmran.github.io/3D-Snake-Game/)



## 🖥️ Technologies Used

- **HTML5** – structure, overlays, and audio tags  
- **CSS3** – styling, colors, animations, HUD design  
- **JavaScript (ES6)** – game logic, snake movement, and UI interactions  
- **Three.js** – 3D rendering, lighting, camera, and effects  
- **MP3 Audio Assets** – background music & sound effects downloaded from external libraries and integrated locally  



## 🎨 Textures Used

- `bg.jpg` → ground/floor surface  
- `snake_diffuse.jpg` → snake skin (base color)  
- `snake_normal.jpg` → snake surface details  
- `snake_rough.jpg` → shininess control  
- `snake_ao.jpg` → ambient occlusion (subtle shadows)  
- `env.hdr` → HDR lighting (optional, improves visuals)
**Special note: i could not upload ground_diffuse.jpg and ground_normal.jpg because these files are too large to upload.

  

🧩 Future Improvements

🎶 More background music & sound effect variations

🐍 Snake skins & custom themes

📱 Mobile optimization with swipe controls

👥 Multiplayer (split-screen or online)

🎯 Endless mode with procedural level generation

📜 License

This project is open-source under the MIT License.

💡 Made with passion by Sarwar Ahmed Emran and Amzad Hossen Jilany 
