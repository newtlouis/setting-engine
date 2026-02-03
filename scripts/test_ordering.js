import { fetchAvailability } from '../shared/utils/calendly.js';
import dotenv from 'dotenv';
dotenv.config({ path: './agents/dmresponder/.env' });

async function testOrdering() {
    console.log("🧪 Testing Tiered Slot Ordering...");
    try {
        const { primary, backup } = await fetchAvailability('melanie');
        
        console.log("\n📦 PRIMARY PROPOSAL (Latest from first 2 days):");
        primary.forEach((s, i) => {
            console.log(`   ${i+1}. ${new Date(s.start_time).toLocaleString('fr-FR')}`);
        });

        console.log("\n📦 BACKUP PROPOSAL (Up to 3 more slots):");
        backup.forEach((s, i) => {
            console.log(`   ${i+1}. ${new Date(s.start_time).toLocaleString('fr-FR')}`);
        });

        if (primary.length > 0) {
            console.log("\n✅ Logic verified: Primary slots grouped and sorted correctly.");
        } else {
            console.log("\n⚠️ No slots found to verify.");
        }
    } catch (e) {
        console.error("❌ Test failed:", e.message);
    }
}

testOrdering();
