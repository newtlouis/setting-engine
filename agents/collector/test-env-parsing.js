/**
 * Test script to verify .env parsing with special characters
 */

import dotenv from 'dotenv';
dotenv.config();

console.log('🧪 Test de parsing des variables d\'environnement\n');

const username = process.env.INSTAGRAM_USERNAME;
const password = process.env.INSTAGRAM_PASSWORD;

console.log('📋 Résultats:');
console.log('─────────────────────────────────────────────────');
console.log(`Username: ${username || '(vide)'}`);
console.log(`Password: ${password ? '********' : '(vide)'}`);
console.log(`Password length: ${password ? password.length : 0} caractères`);

if (password) {
  console.log('\n🔍 Analyse du mot de passe:');
  console.log('─────────────────────────────────────────────────');
  
  const specialChars = {
    'Apostrophe (\')': password.includes("'"),
    'Guillemets doubles (")': password.includes('"'),
    'Espace': password.includes(' '),
    'Dollar ($)': password.includes('$'),
    'Arobase (@)': password.includes('@'),
    'Dièse (#)': password.includes('#'),
    'Exclamation (!)': password.includes('!'),
  };
  
  let hasSpecial = false;
  for (const [char, found] of Object.entries(specialChars)) {
    if (found) {
      console.log(`  ✅ ${char}: Trouvé`);
      hasSpecial = true;
    }
  }
  
  if (!hasSpecial) {
    console.log('  ℹ️  Aucun caractère spécial détecté');
  }
  
  console.log('\n✅ Le mot de passe a été correctement chargé !');
  console.log('   Tu peux maintenant lancer le scraper.');
} else {
  console.log('\n⚠️  Aucun mot de passe configuré.');
  console.log('   Lance ./setup-autologin.sh pour configurer.');
}

console.log('');
