---
layout: home
head:
  - - link
    - rel: canonical
      href: https://opencoworkai.github.io/open-cowork/
  - - link
    - rel: alternate
      hreflang: en
      href: https://opencoworkai.github.io/open-cowork/
  - - link
    - rel: alternate
      hreflang: zh-CN
      href: https://opencoworkai.github.io/open-cowork/zh/
  - - link
    - rel: alternate
      hreflang: x-default
      href: https://opencoworkai.github.io/open-cowork/

hero:
  name: Open Cowork
  text: Open-Source AI Agent Desktop App
  tagline: One-click install for Windows, macOS & Linux. Multi-model support, VM sandbox isolation, built-in Skills, and MCP integration — no coding required.
  image:
    src: /logo.png
    alt: Open Cowork Logo
  actions:
    - theme: brand
      text: Download
      link: https://github.com/OpenCoworkAI/open-cowork/releases
    - theme: alt
      text: View on GitHub
      link: https://github.com/OpenCoworkAI/open-cowork

features:
  - icon: 🚀
    title: One-Click Install
    details: Pre-built installers for Windows (.exe), macOS (.dmg), and Linux (.AppImage). macOS also available via Homebrew. No terminal or coding knowledge required.
  - icon: 🤖
    title: Multi-Model Support
    details: Works with Claude, GPT, Gemini, DeepSeek, GLM, MiniMax, Kimi, and any OpenAI-compatible API. Bring your own API key.
  - icon: 🔒
    title: VM Sandbox Isolation
    details: WSL2 (Windows) and Lima (macOS) powered VM isolation. All commands execute in a secure Linux environment, protecting your host system. Linux uses basic path-based sandboxing by default; run the AppImage in a container for stronger isolation.
  - icon: 🧰
    title: Built-in Skills
    details: Generate PPTX, DOCX, XLSX, and PDF documents with built-in workflows. Create custom skills with the skill-creator toolkit.
  - icon: 🔌
    title: MCP Tool Integration
    details: Connect to browsers, Notion, and desktop apps via Model Context Protocol. Extend AI capabilities beyond file management.
  - icon: 🖥️
    title: GUI Automation
    details: Control and automate desktop GUI applications via computer use. Recommended model — Gemini-3-Pro for best results.
  - icon: 📡
    title: Remote Control
    details: Send commands and receive results via Feishu (Lark) and Slack integration. Automate workflows across collaboration platforms.
  - icon: 🛡️
    title: Free & Open Source
    details: MIT licensed. Fully transparent codebase. Your data stays local — no telemetry, no data sent to Open Cowork servers.
---

<style>
.faq-section {
  max-width: 800px;
  margin: 0 auto;
  padding: 48px 24px;
}
.faq-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 32px;
}
.faq-item {
  margin-bottom: 24px;
}
.faq-item h3 {
  font-size: 1.1em;
  margin-bottom: 8px;
}
.faq-item p {
  color: var(--vp-c-text-2);
  line-height: 1.7;
}

.comparison-section {
  max-width: 700px;
  margin: 0 auto;
  padding: 32px 24px 48px;
}
.comparison-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 24px;
}
.comparison-section table {
  width: 100%;
  border-collapse: collapse;
}
.comparison-section th, .comparison-section td {
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  text-align: center;
}
.comparison-section th {
  background: var(--vp-c-bg-soft);
}

.install-section {
  max-width: 700px;
  margin: 0 auto;
  padding: 32px 24px;
}
.install-section h2 {
  text-align: center;
  font-size: 2em;
  margin-bottom: 24px;
}
</style>

<div class="comparison-section">

## How It Compares

|                 | MCP & Skills | Remote Control | GUI Automation |
| --------------- | :----------: | :------------: | :------------: |
| Claude Cowork   |      ✓       |       ✗        |       ✗        |
| **Open Cowork** |    **✓**     |     **✓**      |     **✓**      |

</div>

<div class="install-section">

## Quick Install

**macOS (Homebrew)**

```bash
brew tap OpenCoworkAI/tap
brew install --cask --no-quarantine open-cowork
```

**Windows / macOS / Linux** — [Download from Releases →](https://github.com/OpenCoworkAI/open-cowork/releases)

</div>

<div class="faq-section">

## Frequently Asked Questions

<div class="faq-item">

### What is Open Cowork?

Open Cowork is a free, open-source AI agent desktop application for Windows, macOS, and Linux. It wraps AI models (Claude, GPT, Gemini, DeepSeek, etc.) into a user-friendly GUI with one-click installation — no terminal or coding knowledge required.

</div>

<div class="faq-item">

### What AI models are supported?

Claude (via Anthropic or OpenRouter), OpenAI-compatible APIs, and Chinese models including GLM (Zhipu AI), MiniMax, and Kimi. Any provider offering an OpenAI-compatible API endpoint can be configured.

</div>

<div class="faq-item">

### Is it free?

Yes. Open Cowork is completely free and open-source under the MIT license. You only pay for AI model API usage from your chosen provider.

</div>

<div class="faq-item">

### How does sandbox isolation work?

Open Cowork uses WSL2 (Windows) or Lima (macOS) to run all AI-executed commands inside an isolated Linux VM. Even if the AI makes a mistake, your host system files remain protected. Linux falls back to basic path-based sandboxing; running the AppImage inside a container provides stronger isolation.

</div>

<div class="faq-item">

### Is my data safe?

Open Cowork runs entirely on your local machine. The only external communication is with the AI model API you configure. No data is sent to Open Cowork servers.

</div>

<div class="faq-item">

### Does it work on Linux?

Yes — pre-built `.AppImage` binaries for Linux x64 ship alongside the Windows `.exe` and macOS `.dmg`. Download the latest `Open Cowork-<version>-linux-x64.AppImage` from the [Releases page](https://github.com/OpenCoworkAI/open-cowork/releases), run `chmod +x` on it, and double-click to launch. Linux uses basic path-based sandboxing by default; run the AppImage inside Docker or Podman for stronger isolation.

</div>

</div>
