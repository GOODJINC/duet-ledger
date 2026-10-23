import {copyFile} from 'node:fs/promises';
await copyFile(new URL('./duet_api.py',import.meta.url),new URL('../web/public/duet_api.py',import.meta.url));
await copyFile(new URL('../API.md',import.meta.url),new URL('../web/public/api-guide.md',import.meta.url));
await copyFile(new URL('../MCP.md',import.meta.url),new URL('../web/public/mcp-guide.md',import.meta.url));
