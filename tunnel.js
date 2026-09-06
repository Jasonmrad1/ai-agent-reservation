import { spawn } from 'child_process';

const cloudflaredPath = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';

console.log('⏳ Starting Cloudflare Tunnel to http://localhost:3000 ...\n');

const child = spawn(cloudflaredPath, ['tunnel', '--url', 'http://localhost:3000'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
  process.stdout.write(data.toString());
});

child.stderr.on('data', (data) => {
  const text = data.toString();
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match) {
    const url = match[0];
    console.log('\n======================================================');
    console.log(`🌐 Public Tunnel URL : ${url}`);
    console.log(`💬 Twilio Inbound URL: ${url}/api/webhook/whatsapp`);
    console.log(`📊 Status Callback   : ${url}/api/webhook/whatsapp/status`);
    console.log('======================================================\n');
    console.log('👉 Paste the Twilio Inbound URL into your Twilio Sandbox Settings!\n');
  } else {
    // Only print error logs that aren't verbose connection heartbeats
    if (!text.includes('connection') && !text.includes('Registered tunnel')) {
      process.stderr.write(text);
    }
  }
});

child.on('error', (err) => {
  console.error('Failed to start cloudflared:', err);
});
