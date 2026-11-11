Below is the extracted website structure and functionality.
1. Complete website section structure
A. Homepage — Overview (/)
Main landing page








dribbble.com


Section	Contents
Hero section	Website-to-app introduction, headline, description
Hero buttons	Choose a Builder, How It Works
Platform preview	Android, Windows, macOS and Linux illustrations
Supported Platforms	Four platform cards
How It Works	Three-step explanation

Hero content
- Turn any website into an app.
- Fast, free and no account required.
- Enter website URL and configure app details.
- Download the generated application.
Supported platforms
Platform	Displayed status	Output
Android	Available	APK
Windows	Available	EXE
macOS	Coming soon	DMG / ZIP
Linux	Coming soon	AppImage / DEB

How It Works
1. Add your website URL.
2. Configure your application.
3. Download your build.
B. Android APK Builder (/android)
Functional builder








r10.net


This page contains the following sections.

1. App Configuration
- Website URL
- App Name
- Automatically generated default information
2. Advanced Options
Subsection	Functionality
App Identity	Version, App ID / Package Name
App Icon	Upload custom PNG/JPEG icon
Automatic Icon	Fetch website favicon
Interface Settings	Progress indicator
Interface Settings	Pull-to-refresh
Interface Settings	Allow pinch-to-zoom
Visual & Launch	Splash screen
Visual & Launch	Full-screen mode
Visual & Launch	Splash screen duration
User Agent	Custom Android User Agent

3. Build Information
- Estimated build time.
- Build APK button.
- Compilation progress bar.
- Success message.
- Error message.
- Retry download link.
4. Android Live Preview

A smartphone mockup showing:
- Application icon.
- Application name.
- Website URL.
- Sample website content.
- Splash screen.
- Android status bar.
- Navigation bar.
- Pull-to-refresh animation.
- Loading progress indicator.
There is also a Play Preview button that demonstrates the preview animations.

5. Build History
- Previously generated builds.
- Application name.
- Build information.
- Download history.
- Clear history button.
6. Google Play Protect Notice

A popup that explains possible security warnings when installing an unsigned or unfamiliar APK.

C. Windows EXE Builder (/windows)
Functional builder








proxlightapps.gumroad.com


1. Windows App Configuration
- Website URL.
- Application Name.
2. Build Engine Selection
Tauri
5–10 MB
Approximate installer size
- Uses system WebView2.
- Requires Windows 10/11.
- Smaller package.


Electron
70–90 MB
Approximate installer size
- Bundles Chromium.
- Self-contained runtime.
- Supports offline use of locally available content.



3. Advanced Options
Subsection	Functionality
App Identity	Version
App Identity	App ID
App Icon	Upload custom icon
Automatic Icon	Fetch website favicon
Installer Type	NSIS Installer (.exe)
Installer Type	Portable App (.exe)
Window Settings	Width
Window Settings	Height
Window Settings	Reset Size
Window Settings	Full Screen
User Agent	Custom User Agent
Defaults	Reset to Defaults

4. Windows Live Preview

Includes:
- Desktop application window.
- Application title bar.
- Application icon.
- Application name.
- Window controls.
- Website content preview.
- Website navigation.
- Sample content cards.
- Windows taskbar.
- Dynamic window dimensions.
The preview updates when the user changes configuration.

5. Build Process
- Build Windows Installer button.
- Build progress bar.
- Build status messages.
- Automatic installer download.
- Download Again option.
- Error handling.
6. Build History
- Previous builds.
- Application details.
- Clear history.
7. Windows SmartScreen Notice

A popup explaining possible warnings when running an unsigned installer.

2. Common website functionality
These features are shared across the website or builder pages.
Feature	Description
Dark/Light Theme	Switch between themes
Theme Persistence	Save selected theme
Automatic App Name	Generate name from website URL
Automatic App ID	Generate package/application ID
Manual Editing	Allow users to customize generated values
Auto Favicon	Fetch website icon
Custom Icon Upload	Upload PNG/JPEG
Live Preview	Update preview when configuration changes
Form Validation	Validate required website URL
URL Normalization	Automatically add HTTPS when missing
Progress Tracking	Display compilation progress
Automatic Download	Start download after successful build
Retry Download	Download an existing completed build again
Local Build History	Save build details in browser storage
Reset Options	Restore default configuration
Loading States	Show build and icon-fetch loading indicators

The Android builder also saves advanced configuration settings in browser storage.
3. About page (/about)
Sections:
1. About SiteToApp
2. Our Mission
3. How SiteToApp Works
4. What You Get
5. Who It's For
6. Security
7. Build Costs
8. Open Source
9. Start Building
10. Our Guarantees
11. Support & Feedback
The page also has shortcuts to Android and Windows builders.
4. Guides page (/guides)
The website contains four tutorials.










1. Publish Website App to Google Play
- Build APK.
- Test on Android device.
- Create Play Console account.
- Upload app release.
- Complete store listing.
- Submit for review.













2. Sign an APK
- Generate keystore.
- Build release APK.
- Sign using apksigner.
- Verify signature.
- Upload to Play Store.













3. Convert Website to Windows App
- Configure website.
- Select Tauri or Electron.
- Choose package type.
- Build installer.
- Distribute application.













4. WebView vs Electron vs Tauri
- Technology comparison.
- Application size.
- Performance.
- Capabilities.
- Technology selection guide.



5. FAQ page (/faq)
The FAQ contains these questions and topics:
1. How does SiteToApp convert a website?
2. Is the compiled APK safe to upload to Google Play?
3. Can I build release configurations locally?
4. Does the wrapper support offline functionality?
5. How do I customize the User Agent?
6. Why does Google Play Protect warn me?
7. How do I publish to Google Play Store?
8. How much does publishing cost?
9. Is converting a website into an app legal?
10. How big is the generated app?
11. Can I add advertisements or push notifications?
12. Do I need Android Studio?
13. How is Windows EXE different from Android APK?
It also contains a contact support section.
6. Updates page (/updates)
The changelog currently includes:
Date	Update
November 9, 2026	Tauri builds and draft releases
November 9, 2026	Brand assets and website improvements
October 15, 2026	Windows EXE builder
Earlier	Android APK builder

Additional links:
- Guides.
- FAQ.
- Contact support.
- Android builder.
- Windows builder.
7. Privacy Policy (/privacy)
The page contains:
1. Website Analytics
2. No Telemetry or Tracking
3. Data in Generated Apps
4. Client Data
5. Your Files
6. Contact
It explains the website's analytics usage, data handling, generated application tracking policy, and ownership of downloaded files.
8. Header and Footer
Header navigation
- Site logo.
- Overview.
- Android APK.
- Windows EXE.
- Dark/Light Theme toggle.
- Buy Me a Coffee.
Footer navigation
- About.
- Guides.
- Updates.
- FAQ.
- Privacy Policy.
- Contact Support.
- Copyright information.
Support email: discovereverything123@gmail.com

9. Technical functionality behind the website
I also checked the JavaScript and backend files.

The website has a real build process, not just demonstration forms.
Application generation workflow
1. Enter website URL and app details


2. Configure application settings


3. Submit build request


4. GitHub Actions compiles application


5. Browser checks build status


Completed
6. Application downloaded


Main technical modules
File	Purpose
src/pages/index.astro	Homepage
src/pages/android.astro	Android builder interface
src/pages/windows.astro	Windows builder interface
src/scripts/app.js	Android functionality
src/scripts/windows.js	Windows functionality
src/layouts/Layout.astro	Shared header, footer and theme
functions/api/build/	Build request handlers
functions/api/download/	APK download handling
functions/api/exe/	Windows build and download handling
builders/	Native application project generators
.github/workflows/	Cloud build workflows

10. Important observations
There are a few things worth knowing before using this project as a reference.
- Android and Windows: These are the two active public builders.
- macOS and Linux: Backend builder modules exist, but these platforms are marked as coming soon on the website.
- Source code downloads: The About and homepage content mention full source ZIP downloads. However, the hosted workflows I inspected currently upload compiled APK/EXE artifacts, and their download handlers extract those compiled files. I could not verify a separate source ZIP download option in the public builder interface.
- Build history: The website saves history in browser storage, not in a user account.

11. Original source repository
These are the most useful files to inspect:
Resource	Source
Complete project	GitHub repository
Homepage	Homepage code
Android builder	Android page
Windows builder	Windows page
Android functionality	Android JavaScript
Windows functionality	Windows JavaScript
Backend documentation	Backend documentation

Overall: The project contains 8 main page groups, two active application builders, four documentation guides, live previews, build tracking, automatic compilation, and download functionality.

The next useful step would be turning this extraction into a complete developer-ready requirements document, including every page, component, input field, button, interaction, and backend function needed to recreate the website.
