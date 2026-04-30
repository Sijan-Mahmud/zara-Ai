#!/usr/bin/env python3
import sys
import io
import time
import json
import re
from os import environ
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from selenium.webdriver import Remote, ChromeOptions as Options
from selenium.webdriver.chromium.remote_connection import ChromiumRemoteConnection as Connection
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

from user_agent import generate_user_agent
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeRemainingColumn
from rich.panel import Panel
import telebot

console = Console()

yoyo_useragent = generate_user_agent()

AUTH = environ.get("BRIGHT_DATA_AUTH", "https://brd-customer-hl_58af6316-zone-browser:5mzxbtgbgt0l@brd.superproxy.io:9515")
TARGET_URL = environ.get("TARGET_URL", "https://aincrad.decryptvpn.xyz/getkey")
BOT_TOKEN = environ.get("TELEGRAM_BOT_TOKEN", "8678262704:AAGSmXC4EufsfvYnj41M1JEYm4_oga0CUTY")

def countdown_bar(seconds, description="Waiting..."):
    with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(complete_style="cyan", finished_style="green"),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            TimeRemainingColumn(),
            console=console
    ) as progress:
        task = progress.add_task(description, total=seconds)
        for _ in range(seconds):
            time.sleep(1)
            progress.advance(task)


def execute_cdp(driver, cmd, params=None):
    if params is None:
        params = {}
    try:
        if hasattr(driver, "execute_cdp_cmd"):
            return driver.execute_cdp_cmd(cmd, params)

        result = driver.execute("executeCdpCommand", {
            "cmd": cmd,
            "params": params,
        })
        return result.get("value", {})
    except Exception as e:
        console.print(f"[bold red]Error executing CDP command {cmd}: {e}[/bold red]")
        return {}


def extract_token(bot=None, chat_id=None):
    server_addr = AUTH if AUTH.startswith("https://") else f"https://{AUTH}"
    connection = Connection(server_addr, "goog", "chrome")

    options = Options()
    options.add_argument("--ignore-certificate-errors")
    options.add_argument("--ignore-ssl-errors")
    options.add_argument("--allow-running-insecure-content")
    options.add_argument("--disable-web-security")
    options.add_argument("--allow-insecure-localhost")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    options.add_argument(f"user-agent={yoyo_useragent}")

    driver = None 
    try:
        with console.status("[bold green]Connecting to remote scraping browser (Headless)...", spinner="dots"):
            driver = Remote(connection, options=options)

        driver.set_window_size(390, 844)

        with console.status("[bold cyan]Navigating to getkey page & solving Captcha...", spinner="bouncingBar"):
            driver.get(TARGET_URL)
            result = execute_cdp(driver, "Captcha.waitForSolve", {"detectTimeout": 10 * 1000})
            status = result.get("status", "unknown")
            console.print(f"[bold green]Captcha Status:[/bold green] {status}")

            if bot and chat_id:
                try:
                    bot.send_message(chat_id, "🛡️ *Cloudflare Captcha Solved Successfully!*", parse_mode="Markdown")
                except Exception as e:
                    console.print(f"[bold yellow]⚠️ Failed to send Telegram update: {e}[/bold yellow]")

            interceptor_script = """
            (function() {
                window.interceptedData = [];
                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    try {
                        const response = await originalFetch(...args);
                        const clone = response.clone();
                        const text = await clone.text();
                        window.interceptedData.push({
                            url: args[0],
                            body: text
                        });
                        return response;
                    } catch (e) {
                        return originalFetch(...args);
                    }
                };
                
                const originalOpen = XMLHttpRequest.prototype.open;
                const originalSend = XMLHttpRequest.prototype.send;
                
                XMLHttpRequest.prototype.open = function(method, url, ...rest) {
                    this._url = url;
                    return originalOpen.apply(this, [method, url, ...rest]);
                };
                
                XMLHttpRequest.prototype.send = function(...args) {
                    this.addEventListener('load', function() {
                        try {
                            window.interceptedData.push({
                                url: this._url,
                                body: this.responseText
                            });
                        } catch (e) {}
                    });
                    return originalSend.apply(this, args);
                };
            })();
            """
            try:
                driver.execute_script(interceptor_script)
                console.print("[bold green]Injected network interceptor script.[/bold green]")
            except Exception as e:
                console.print(f"[bold yellow]Warning: Failed to inject interceptor script: {e}[/bold yellow]")

            try:
                wait = WebDriverWait(driver, 30) 
                button = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(., 'Click to continue') or contains(., 'Continue')]")))
                driver.execute_script("arguments[0].click();", button)
                console.print("[bold green]Clicked button via JS.[/bold green]")
            except TimeoutException:
                console.print("[bold yellow]Warning: 'Click to continue' button not found or not clickable within timeout. Proceeding without clicking.[/bold yellow]")
            except NoSuchElementException:
                console.print("[bold yellow]Warning: 'Click to continue' button element not found. Proceeding without clicking.[/bold yellow]")

        countdown_bar(10, "[magenta]Waiting for background processes and cookies...[/magenta]")

        all_cookies = execute_cdp(driver, "Network.getAllCookies")
        cookies = {c["name"]: c["value"] for c in all_cookies.get("cookies", [])}
        cf_clearance = cookies.get("cf_clearance")
        session = cookies.get("__session")

        console.print(Panel(
            f"[bold green]cf_clearance:[/bold green] {cf_clearance}\n"
            f"[bold green]__session:[/bold green] {session}",
            title="[bold yellow]🍪 Extracted Cookies[/bold yellow]", expand=False
        ))

        token = None

        if not token:
            with console.status("[bold yellow]Scanning Local & Session Storage...", spinner="dots"):
                try:
                    token = driver.execute_script("return localStorage.getItem('token') || sessionStorage.getItem('token')")
                    if not token:
                        ls = driver.execute_script("return JSON.stringify(localStorage)")
                        ss = driver.execute_script("return JSON.stringify(sessionStorage)")
                        for storage_str in [ls, ss]:
                            if storage_str:
                                data = json.loads(storage_str)
                                for k, v in data.items():
                                    if isinstance(v, str) and re.match(r"^[a-zA-Z0-9]{32}$", v):
                                        token = v
                                        break
                                if token:
                                    break
                except Exception as e:
                    console.print(f"[bold yellow]⚠️ Storage scanning failed: {e}[/bold yellow]")

        if not token:
            with console.status("[bold yellow]Scanning page source for token...", spinner="dots"):
                try:
                    page_source = driver.page_source
                    match = re.search(r"token=([a-zA-Z0-9]+)", page_source)
                    if match:
                        token = match.group(1)
                except Exception as e:
                    console.print(f"[bold yellow]⚠️ Page source scanning failed: {e}[/bold yellow]")

        if not token:
            with console.status("[bold yellow]Scanning URL for token...", spinner="dots"):
                try:
                    current_url = driver.current_url
                    match = re.search(r"token=([a-zA-Z0-9]+)", current_url)
                    if match:
                        token = match.group(1)
                except Exception as e:
                    console.print(f"[bold yellow]⚠️ URL scanning failed: {e}[/bold yellow]")

        if not token:
            with console.status("[bold yellow]Fetching page via requests using cookies...", spinner="dots"):
                try:
                    headers = {
                        "User-Agent": yoyo_useragent,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
                    }
                    req_cookies = {
                        "cf_clearance": cf_clearance,
                        "__session": session,
                    }
                    response = requests.get(TARGET_URL, headers=headers, cookies=req_cookies, verify=False)
                    match = re.search(r"token=([a-zA-Z0-9]+)", response.text)
                    if match:
                        token = match.group(1)
                    if not token:
                        matches = re.findall(r"\b([a-fA-F0-9]{32})\b", response.text)
                        for m in matches:
                            if m != cf_clearance and m != session:
                                token = m
                                break
                except Exception as e:
                    print(f"[bold yellow]⚠️ Requests fallback failed: {e}[/bold yellow]")

        if not token:
            with console.status("[bold yellow]Scanning intercepted XHR/Fetch data (with retries)...", spinner="dots"):
                for attempt in range(5):
                    try:
                        intercepted = driver.execute_script("return JSON.stringify(window.interceptedData || [])")
                        intercepted_data = json.loads(intercepted)
                        for item in intercepted_data:
                            body = item.get("body", "")
                            if "token=" in body:
                                match = re.search(r"token=([a-zA-Z0-9]{10,})", body)
                                if match:
                                    token = match.group(1)
                                    break
                            if not token:
                                matches = re.findall(r"\b([a-fA-F0-9]{32})\b", body)
                                for m in matches:
                                    if m != cf_clearance and m != session:
                                        token = m
                                        break
                                if token:
                                    break
                        if token:
                            break
                        time.sleep(5)
                    except Exception as e:
                        console.print(f"[bold yellow]⚠️ Intercepted data scanning failed on attempt {attempt+1}: {e}[/bold yellow]")
                        time.sleep(5)

        if token:
            console.print(Panel(f"[bold cyan]{token}[/bold cyan]", title="[bold green]🔑 Token Found[/bold green]", expand=False))
            
            if bot and chat_id:
                try:
                    bot.send_message(chat_id, f"🔑 *The session Token is successfully captured!*\n`{token}`", parse_mode="Markdown")
                except Exception as e:
                    console.print(f"[bold yellow]⚠️ Failed to send Telegram update: {e}[/bold yellow]")

            countdown_bar(20, "[yellow]Cooldown before requesting final key...[/yellow]")

            with console.status("[bold cyan]Submitting token to generate key via browser...", spinner="dots2"):
                driver.get(f"https://aincrad.decryptvpn.xyz/getkey?token={token}")

            WebDriverWait(driver, 30).until(
                EC.presence_of_element_located((By.XPATH, "//*[contains(text(), 'AINCRAD-')]"))
            )

            page_content = driver.page_source
            match = re.search(r"AINCRAD-[A-Z0-9\-]+\b", page_content) 

            if match:
                key = match.group(0)
                console.print(Panel(f"[bold cyan] ✅ KEY: {key} [/bold cyan]", title="[bold green]🎉 Success[/bold green]", expand=False))
                return token, cf_clearance, session, key 
            else:
                console.print(Panel(f"[bold red]❌ Key not found in browser page source[/bold red]\n[yellow]Page Snippet:[/yellow] {page_content[:500]}", title="[bold red]Error[/bold red]", expand=False))
                return None, None, None, None
        else:
            console.print("[bold red]❌ Token not found in logs, page source, or URL.[/bold red]")
            return None, None, None, None

    finally:
        if driver:
            try:
                driver.quit()
            except Exception as e:
                console.print(f"[bold red]Error quitting driver: {e}[/bold red]")


# ==========================================
# Telegram Bot Logic
# ==========================================

bot = telebot.TeleBot(BOT_TOKEN)

@bot.message_handler(commands=['start', 'help'])
def send_welcome(message):
    welcome_text = (
        "🌟 *Welcome to Aincrad Key Generator Bot* 🌟\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "🤖 *Assistant Status:* `Online & Ready`\n"
        "⚡ *Engine:* `key generator`\n\n"
        "Use the command below to start your secure key generation session.\n\n"
        "🚀 `/getkey` — *Generate fresh activation key*\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "👨‍💻 *Developer:* `Mr. Ghost` | 📱 [Support](https://t.me/MrGhost4201)"
    )
    bot.reply_to(message, welcome_text, parse_mode="Markdown", disable_web_page_preview=True)

@bot.message_handler(commands=['getkey'])
def handle_getkey(message):
    processing_text = (
        "🔄 *Session Initialized*\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "📡 Connecting to Aincrad server...\n"
        "🕵️ Bypassing security checkpoints...\n"
        "⏱️ _Estimated time: 1-2 minutes._\n"
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        "⏳ *Please do not send another request.*"
    )
    bot.reply_to(message, processing_text, parse_mode="Markdown")
    
    try:
        # Call the robust extraction with bot and chat_id
        token, cf_clearance, session, key = extract_token(bot=bot, chat_id=message.chat.id)
        
        if key:
            success_text = (
                "🎉 *Aincrad Key Generated Successfully!* 🎉\n"
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                "🔓 *Your Activation Key is below:*\n\n"
                "`{key}`\n\n"
                "📋 _Tap the key above to copy it._\n"
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                "Thank you for using our service!"
            ).format(key=key)
            bot.reply_to(message, success_text, parse_mode="Markdown")
        else:
            bot.reply_to(message, "❌ *Error:* Failed to generate the key. Token or cookies missing, or security bypass failed.", parse_mode="Markdown")
            
    except Exception as e:
        error_text = (
            "❌ *Operation Failed*\n"
            "━━━━━━━━━━━━━━━\n"
            "An unexpected error occurred:\n"
            "`{error_msg}`"
        ).format(error_msg=str(e))
        bot.reply_to(message, error_text, parse_mode="Markdown")

if __name__ == "__main__":
    print("🚀 Telegram Bot is now running (Single File Headless Mode)!")
    print("📱 Go to your phone's Telegram and send /getkey to the bot.")
    print("Press Ctrl+C to stop.")
    bot.infinity_polling()
