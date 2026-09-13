/**
 * Interactive WhatsApp CLI Simulator for Dr. Ziad El Khoury Clinic
 * Runs directly in terminal without Twilio API limits or costs.
 * 
 * Usage: npx tsx scripts/chat_simulator.ts
 */

import readline from 'readline';

const API_BASE = process.env.SERVER_URL || 'http://localhost:3000/api/simulator';

let currentPhone = '+96171476193';
let currentName = 'Jason Mrad';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\n💬 You > ',
});

console.log('===============================================================');
console.log('📱 DR. ZIAD EL KHOURY — WHATSAPP LIVE SIMULATOR');
console.log('⚡ Direct Backend & Gemini Testing (Zero Twilio limits / costs)');
console.log('===============================================================');
console.log(`👤 Active Patient: ${currentName} (${currentPhone})`);
console.log('💡 Commands:');
console.log('   /reset        -> Wipes conversation & test booking (fresh slate)');
console.log('   /history      -> Shows recent chat transcript');
console.log('   /phone <num>  -> Switch active test phone number');
console.log('   /name <name>  -> Set patient profile name');
console.log('   exit / quit   -> Exit simulator');
console.log('---------------------------------------------------------------\n');

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:3000/health');
    return res.ok;
  } catch {
    return false;
  }
}

async function sendMessage(text: string) {
  try {
    process.stdout.write('🤖 Clinic Assistant is typing...\r');
    const res = await fetch(`${API_BASE}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: currentPhone,
        name: currentName,
        text,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: res.statusText }));
      console.log(`\n❌ Error (${res.status}): ${errData.error || 'Server error'}`);
      return;
    }

    const data = await res.json();
    console.log('\n🩺 Clinic Assistant:');
    console.log('───────────────────────────────────────────────────────────────');
    console.log(data.reply);
    console.log('───────────────────────────────────────────────────────────────');

    if (data.guardrailTriggered) {
      console.log(`🛡️ [Guardrail Intercepted: ${data.reason}] (0 tokens spent)`);
    }

    if (data.appointments && data.appointments.length > 0) {
      console.log(`📅 Active Bookings on file (${data.appointments.length}):`);
      for (const a of data.appointments) {
        const d = new Date(a.start_time);
        console.log(`   • ${d.toLocaleString()} [${a.status.toUpperCase()}] - ${a.service} (${a.visit_type})`);
      }
    }
  } catch (err: any) {
    console.log(`\n❌ Failed to communicate with server: ${err.message}`);
    console.log('💡 Ensure the backend server is running on http://localhost:3000');
  }
}

async function showHistory() {
  try {
    const res = await fetch(`${API_BASE}/history?phone=${encodeURIComponent(currentPhone)}`);
    if (!res.ok) {
      console.log('❌ Could not fetch history');
      return;
    }
    const data = await res.json();
    console.log(`\n📜 Transcript for ${currentPhone} (${data.messages?.length || 0} messages):`);
    console.log('───────────────────────────────────────────────────────────────');
    for (const m of data.messages || []) {
      const sender = m.direction === 'inbound' ? `👤 ${currentName}` : '🩺 Dr. Ziad Clinic';
      console.log(`[${new Date(m.created_at).toLocaleTimeString()}] ${sender}:`);
      console.log(m.body);
      console.log('');
    }
    console.log('───────────────────────────────────────────────────────────────');
  } catch (err: any) {
    console.log(`❌ Error: ${err.message}`);
  }
}

async function start() {
  const isUp = await checkHealth();
  if (!isUp) {
    console.warn('⚠️ Warning: Backend server on http://localhost:3000 is not reachable yet.');
    console.warn('   Start it with: npx tsx watch src/index.ts\n');
  }

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === 'exit' || input === 'quit' || input === '/exit') {
      console.log('👋 Exiting WhatsApp Simulator.');
      process.exit(0);
    }

    if (input === '/history') {
      await showHistory();
      rl.prompt();
      return;
    }

    if (input.startsWith('/phone ')) {
      currentPhone = input.replace('/phone ', '').trim();
      console.log(`📱 Active phone changed to: ${currentPhone}`);
      rl.prompt();
      return;
    }

    if (input.startsWith('/name ')) {
      currentName = input.replace('/name ', '').trim();
      console.log(`👤 Active patient name changed to: ${currentName}`);
      rl.prompt();
      return;
    }

    await sendMessage(input);
    rl.prompt();
  });
}

start();
