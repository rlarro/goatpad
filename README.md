# GoatPad

A lightweight macOS markdown editor built for long-form writing projects done in collaboration with Claude.

![GoatPad empty state](docs/screenshot.png)

## Why this exists

I spent about a month writing a book with Claude as a drafting partner. Half the project was the writing. The other half was fighting Word format round-trips, lost section breaks, and smart quotes turning into escape sequences. One bad section move cost me an entire afternoon of cleanup. And the .docx files were eating up my Claude usage on every pass.

GoatPad is the editor I wish I'd had on day one. Markdown in, markdown out, no surprises in between. It plays nicely with Claude's file workflow and stays out of your way.

The companion repository **[goat-tools](https://github.com/rlarro/goat-tools)** has the markdown templates and the manuscript build script that came out of the same project.

## What it does

- Clean markdown editing with live preview
- Standard formatting controls (bold, italics, headers, lists, links)
- One-key versioned saves: Cmd+Shift+S writes the next numbered draft
- File-based, no cloud sync, no account required
- Round-trips cleanly to and from Claude without mangling your formatting
- Native macOS app, runs offline

## Install

Download the latest release from the [Releases page](../../releases/latest).

Open the `.dmg`, drag GoatPad.app to your Applications folder, then eject the disk image. (A `.zip` is also available as an alternative.)

**First launch:** macOS Gatekeeper will block GoatPad with a dialog saying *"Apple could not verify GoatPad is free of malware."* This is normal for unsigned open-source apps. To allow it:

1. Click **Done** in the blocking dialog
2. Open **System Settings → Privacy & Security**
3. Scroll down to the **Security** section (near the bottom of the page)
4. Find the message about GoatPad being blocked and click **Open Anyway**
5. Confirm with your password or Touch ID

After that, GoatPad launches normally every time you open it.

Universal binary, runs on both Intel and Apple Silicon Macs.

## Build from source

Requires Node.js 18+.

```bash
git clone https://github.com/rlarro/goatpad.git
cd goatpad
npm install
npm run dist
```

The built `.dmg` and `.zip` land in `dist/`.

## License

MIT. Use it, fork it, ship your own version.

Built with Claude Code in an afternoon. Refined over a couple of weeks of actual use.
