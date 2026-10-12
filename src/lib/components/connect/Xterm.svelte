<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal, type ITerminalOptions } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  let {
    hostname = "",
    username = "",
    terminalOptions,
    onState = () => {},
    onError = () => {},
  }: {
    hostname?: string;
    username?: string;
    terminalOptions?: ITerminalOptions;
    onState?: (s: string) => void;
    onError?: (e: string) => void;
  } = $props();
  let el: HTMLDivElement;
  onMount(() => {
    let closed = false;
    let read: ((s: string) => void) | undefined;
    let session: IPNSSHSession | undefined;
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      theme: {
        background: "#0a1016",
        foreground: "#dbe8e0",
        cursor: "#a7efc4",
        selectionBackground: "#2d4d43",
      },
      ...terminalOptions,
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon((_e, url) => window.open(url, "_blank", "noopener"));
    terminal.loadAddon(fit);
    terminal.loadAddon(links);
    terminal.open(el);
    fit.fit();
    terminal.focus();
    const observer = new ResizeObserver(() => {
      if (!closed) {
        fit.fit();
        session?.resize(terminal.rows, terminal.cols);
      }
    });
    observer.observe(el);
    const data = terminal.onData((value) => read?.(value));
    terminal.writeln(`\x1b[38;2;167;239;196mConnecting to ${username}@${hostname}…\x1b[0m\r\n`);
    session = window.ipn.ssh(hostname, username, {
      writeFn: (s) => {
        if (!closed) terminal.write(s);
      },
      writeErrorFn: (e) => {
        if (!closed) {
          terminal.write(e);
          onError(e);
        }
      },
      setReadFn: (hook) => (read = hook),
      rows: terminal.rows,
      cols: terminal.cols,
      onConnectionProgress: () => onState("Connecting"),
      onConnected: () => {
        if (!closed) onState("Connected");
      },
      onDone: () => {
        if (!closed) {
          read = undefined;
          onState("Disconnected");
          terminal.writeln(
            "\r\n\x1b[90mSession ended. Reconnect or choose another machine above.\x1b[0m",
          );
        }
      },
      timeoutSeconds: 30,
    });
    const leave = (e: BeforeUnloadEvent) => {
      if (read) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => {
      closed = true;
      window.removeEventListener("beforeunload", leave);
      session?.close();
      observer.disconnect();
      data.dispose();
      terminal.dispose();
    };
  });
</script>

<div class="mesh-terminal" bind:this={el}></div>
