# How Site2App Works & Cloud Deployment Guide

This guide explains the inner workings of the **Site2App** website generator, clarifies how compilation is processed locally, and outlines the steps needed to host the application on **Cloudflare Pages**.

---

## 1. How the Website Works Locally

When running Site2App on your local machine (`npm run dev` or `npm start`), it acts as a self-contained system consisting of a static frontend and a local Node.js compilation server.

```mermaid
graph TD
    A[Frontend: index.html / app.js] -- 1. Submit Settings --> RL{Rate Limiter}
    RL -- Allowed (Max 10 / 15m) --> B[Express Server: server.js]
    RL -- Exceeded --> A1[Return 429 Too Many Requests]
    B -- 2. Download Favicon --> C[Google Favicon API]
    C -- Favicon Buffer --> B
    B -- 3. Generate Android Project --> D[Isolated builds/buildId Folder]
    B -- 4. Add to Task Queue --> Q{Queue Manager}
    Q -- BullMQ / Local Fallback --> E[Gradle Worker (Max 3 Parallel)]
    E -- 5. Run gradle assembleDebug --> F[Local Java & Gradle Compiler]
    F -- Compiled APK --> D
    Q -- Complete Status --> B
    B -- 6. Poll Completed Status --> A
    A -- 7. Pull Download Link --> G[User Browser Download]
```

### Step-by-Step Workflow:
1. **Frontend Interface (`app.js` & HTML)**:
   - When you enter your website URL and select your preferences, `app.js` validates the inputs and auto-generates a Package ID (e.g. `com.google.portal` for `google.com`).
   - If **Auto Fetch Website Icon** is checked, the browser requests the favicon from the server's favicon proxy (`/api/favicon`) which fetches and converts it to PNG.
   - When you click **Deploy App to APK**, the frontend sends a POST request with the JSON configuration payload to the local server endpoint `/api/build/apk`.

2. **Rate Limiting & Authentication (`server.js`)**:
   - The request hits the `compilerLimiter` middleware. It tracks the IP address of the sender using a sliding window.
   - If the IP has exceeded 10 compilation requests in 15 minutes, it immediately aborts the request and returns a `429 Too Many Requests` status. Otherwise, it allows the request.

3. **Backend Server & Task Queue (`server.js` & `queue-manager.js`)**:
   - The Express backend registers the compilation in a local `buildQueue` Map with a status of `pending` and replies to the frontend with a unique `buildId` (e.g. `858fb151...`) so the client can start polling for progress.
   - In the background, instead of calling the builder directly, it routes the request through the `Queue Manager`.
   - The `Queue Manager` pushes the task to a **BullMQ** queue backed by **Redis** (or falls back to an in-memory local queue if Redis is not running). The queue limits active builds to **3 parallel workers** to prevent CPU and RAM exhaustion.

4. **Favicon Processing & Project Setup**:
   - When the worker picks up the job, it runs `builders/android-builder.js` inside an isolated directory (`builds/{buildId}/android/`) to prevent conflict with other concurrent builds.
   - It fetches/converts the favicon using the **Sharp** image processing library and outputs multiple sizes of `ic_launcher.png` for Android density folders (`hdpi`, `xhdpi`, `xxhdpi`, etc.).
   - It writes files such as `AndroidManifest.xml`, gradle configurations, resource rules (`backup_rules.xml`), and the core `MainActivity.java` containing the WebView code preconfigured with settings like loading spinners, zoom support, full-screen support, and custom User Agents.

5. **Gradle Compilation**:
   - The worker triggers your local Java Runtime Environment (JDK 17+) and runs the local Gradle wrapper command (`gradlew assembleDebug`).
   - Once compiling finishes, the worker copies the finished `.apk` file into the main build directory and marks the queue task status as `completed`.
   - The client-side browser, which has been polling the status, triggers a download link for the completed `.apk`.

---

## 2. Does it send requests to GitHub Actions when running locally?

**No.** 
- When running locally, **all compilation happens entirely on your local machine** using your local Gradle installation and Java Development Kit (JDK). 
- No HTTP requests are sent to GitHub or GitHub Actions to compile the APK during local execution.
- **Why is GitHub Actions mentioned?** The generated project workspace ZIP includes a `.github/workflows/build.yml` file. This is a helper feature: if you decide to push the generated source code to your own GitHub repository, GitHub's free runners will automatically detect the workflow and compile release APKs for you in the cloud for free.

---

## 3. Hosting on Cloudflare Pages (Deployment Guide)

**Cloudflare Pages** is a Jamstack platform designed to compile and host **static frontend files** (HTML, CSS, JS). 

Because Cloudflare Pages runs on a serverless Edge Network without access to a persistent disk or developer build environments (like Gradle, Android SDK, and JDK), **you cannot host both the frontend and the compiler backend together on Cloudflare Pages.**

To deploy the project to production, you must use a **split-hosting architecture**:

```
[ User Browser ] ───► Serves Frontend UI (Cloudflare Pages)
       │
       └─────────────► Sends Build Requests (Hosted Backend VPS / Render / Railway)
```

### Steps to split and deploy:

### Step 1: Deploy the Backend to a Host with build tools
You must host the Node.js backend (`server.js`, `builders/`) on a cloud platform that supports persistent servers or Docker container builds where Gradle and JDK can be installed. Great options include:
- **Railway.app** (Fits our theme perfectly!)
- **Render.com** (Supports custom Docker runtimes)
- **A VPS** (Ubuntu instance with JDK 17 and Gradle installed)

*Note: Ensure that the platform has JDK 17 installed or use a Docker container based on a Java/Gradle image.*

### Step 2: Configure CORS on the Backend
Because your frontend will run on Cloudflare Pages (e.g., `https://site2app.pages.dev`) and the backend will run on another domain (e.g., `https://site2app-api.railway.app`), you must allow cross-origin requests.
In `server.js` (Line 27), the CORS middleware is already enabled:
```javascript
app.use(cors()); // Allows all origins by default
```
*(In production, you can restrict this to your Cloudflare Pages domain for security).*

### Step 3: Update Frontend API Target in `app.js`
In [app.js](file:///home/anwin/Documents/VS%20Codes/websitetoapp/app.js) (Line 320), the backend URL is derived dynamically from the current origin:
```javascript
const backendUrl = window.location.origin;
```
You must change this to point directly to your cloud-hosted backend API. Change it to:
```javascript
const backendUrl = "https://your-backend-api.railway.app";
```

### Step 4: Host Frontend on Cloudflare Pages
1. Push your updated code to GitHub.
2. Go to the Cloudflare Dashboard -> **Workers & Pages** -> **Create application** -> **Pages**.
3. Connect your GitHub repository.
4. Select the build settings:
   - **Framework preset**: `None` (Static HTML/JS)
   - **Build command**: Leave blank
   - **Build output directory**: `/` (root directory containing `index.html`, `android.html`, `app.js`, `styles.css`)
5. Click **Save and Deploy**. Cloudflare will serve your static UI globally with lightning-fast load times.
