/**
 * Test the enhanced CRM with improved engagement scoring
 */

import { ExcelCRM } from './src/excel_writer.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testEnhancedCRM() {
  console.log('🧪 Test du CRM avec algorithme d\'engagement amélioré\n');
  
  // Mock data with various engagement levels
  const mockData = [
    // User 1: HIGH engagement (frequent, recent, quality)
    { 
      username: 'engaged_user_high',
      profile_url: 'https://instagram.com/engaged_user_high',
      comment_text: 'This is amazing! How did you achieve this result? I would love to learn more about your process and methodology! 🔥',
      comment_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      post_url: 'https://instagram.com/p/test1',
      hashtag_source: '#marketing'
    },
    { 
      username: 'engaged_user_high',
      profile_url: 'https://instagram.com/engaged_user_high',
      comment_text: '@yourpage Thanks for the detailed explanation! This really helped me understand better 🙏',
      comment_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      post_url: 'https://instagram.com/p/test1',
      hashtag_source: '#marketing'
    },
    { 
      username: 'engaged_user_high',
      profile_url: 'https://instagram.com/engaged_user_high',
      comment_text: 'Can\'t wait for your next post! Your content is always top quality! 💯',
      comment_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      post_url: 'https://instagram.com/p/test1',
      hashtag_source: '#marketing'
    },
    { 
      username: 'engaged_user_high',
      profile_url: 'https://instagram.com/engaged_user_high',
      comment_text: 'Just implemented this and it worked perfectly! You\'re a legend! 🚀',
      comment_date: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      post_url: 'https://instagram.com/p/test1',
      hashtag_source: '#marketing'
    },
    
    // User 2: MEDIUM engagement (some activity, decent quality)
    { 
      username: 'engaged_user_medium',
      profile_url: 'https://instagram.com/engaged_user_medium',
      comment_text: 'Great content! Really appreciate what you share here 👍',
      comment_date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      post_url: 'https://instagram.com/p/test2',
      hashtag_source: '#business'
    },
    { 
      username: 'engaged_user_medium',
      profile_url: 'https://instagram.com/engaged_user_medium',
      comment_text: 'Thanks for this!',
      comment_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      post_url: 'https://instagram.com/p/test2',
      hashtag_source: '#business'
    },
    
    // User 3: LOW engagement (single emoji)
    { 
      username: 'engaged_user_low',
      profile_url: 'https://instagram.com/engaged_user_low',
      comment_text: '🔥',
      comment_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      post_url: 'https://instagram.com/p/test3',
      hashtag_source: '#sales'
    },
    
    // User 4: LOW engagement (old comment)
    { 
      username: 'inactive_user',
      profile_url: 'https://instagram.com/inactive_user',
      comment_text: 'Nice',
      comment_date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
      post_url: 'https://instagram.com/p/test4',
      hashtag_source: '#growth'
    }
  ];
  
  const outputDir = path.join(__dirname, 'output');
  const writer = new ExcelCRM(outputDir);
  const outputPath = path.join(outputDir, 'instagram_prospects.xlsx');
  
  console.log('📝 Initialisation du fichier Excel...');
  await writer.load();
  
  console.log('💾 Ajout des prospects avec différents niveaux d\'engagement...\n');
  const result = await writer.updateWithComments(mockData, 'test');
  
  console.log('💾 Sauvegarde du fichier Excel...');
  await writer.save();
  
  console.log('\n📊 RÉSULTATS:');
  console.log(`   ✅ Nouveaux prospects: ${result.new_prospects}`);
  console.log(`   💬 Nouveaux commentaires: ${result.new_comments}`);
  console.log(`   📁 Fichier: ${outputPath}\n`);
  
  console.log('🎯 ATTENDU (basé sur l\'algorithme):');
  console.log('   • engaged_user_high   → HIGH   (43+ points)');
  console.log('   • engaged_user_medium → MEDIUM (20+ points)');
  console.log('   • engaged_user_low    → LOW    (8 points)');
  console.log('   • inactive_user       → LOW    (2 points)\n');
  
  console.log('✅ Test terminé!\n');
  console.log('💡 Pour vérifier:');
  console.log('   1. Ouvre le fichier Excel');
  console.log('   2. Va dans l\'onglet "Prospects"');
  console.log('   3. Regarde les colonnes "Engagement Level" et "Score"');
  console.log('   4. Trie par Score décroissant pour voir la distribution\n');
}

testEnhancedCRM().catch(console.error);
