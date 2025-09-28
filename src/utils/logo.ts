/**
 * perfecXion.ai ASCII Art Logo
 * Developed by perfecXion.ai Team
 */

// ANSI color codes
const RESET = '\x1b[0m';
const DIM_WHITE = '\x1b[2m\x1b[37m';
const LIGHT_MAGENTA = '\x1b[95m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';

export function printLogo(): void {
  // perfecXion.ai official ASCII art logo
  const logo = `
    ██████╗ ███████╗██████╗ ███████╗███████╗ ██████╗██╗  ██╗██╗ ██████╗ ███╗   ██╗
    ██╔══██╗██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝╚██╗██╔╝██║██╔═══██╗████╗  ██║
    ██████╔╝█████╗  ██████╔╝█████╗  █████╗  ██║      ╚███╔╝ ██║██║   ██║██╔██╗ ██║
    ██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ██╔══╝  ██║      ██╔██╗ ██║██║   ██║██║╚██╗██║
    ██║     ███████╗██║  ██║██║     ███████╗╚██████╗██╔╝ ██╗██║╚██████╔╝██║ ╚████║
    ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
                                        .ai
`;

  // Apply gradient coloring (blue to purple like perfecXion brand)
  const lines = logo.split('\n');
  const totalLines = lines.length;

  lines.forEach((line, index) => {
    if (line.trim()) {
      // Create gradient from blue to purple
      const progress = totalLines > 1 ? index / (totalLines - 1) : 0;
      const r = Math.round(37 + (147 - 37) * progress);    // 37 -> 147 (blue to purple)
      const g = Math.round(99 + (51 - 99) * progress);     // 99 -> 51
      const b = Math.round(235 + (234 - 235) * progress);  // 235 -> 234

      const color = `\x1b[38;2;${r};${g};${b}m`;
      console.log(`${color}${line}${RESET}`);
    } else {
      console.log(line);
    }
  });

  console.log(`${BOLD}${CYAN}    🚀 Secure MCP Server by perfecXion.ai${RESET}`);
  console.log(`${CYAN}    Enterprise-Grade Model Context Protocol Implementation${RESET}`);
  console.log(`${CYAN}    https://perfecxion.ai${RESET}\n`);
}

export function printStartupMessage(port: number): void {
  console.log(`${BOLD}${CYAN}✅ Server started successfully!${RESET}`);
  console.log(`${CYAN}   📡 WebSocket endpoint: ws://localhost:${port}${RESET}`);
  console.log(`${CYAN}   🌐 HTTP endpoint: http://localhost:${port}${RESET}`);
  console.log(`${CYAN}   📚 API docs: http://localhost:${port}/docs${RESET}`);
  console.log(`${CYAN}   🔧 Health check: http://localhost:${port}/health${RESET}\n`);
}