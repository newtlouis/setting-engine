/**
 * Test script to demonstrate the new engagement scoring algorithm
 */

// Simulate the new calculateEngagementScore function
function calculateEngagementScore(comments) {
  if (!comments || comments.length === 0) return 'LOW';
  
  const now = new Date();
  let score = 0;
  
  // 1. FREQUENCY SCORE (0-10 points)
  score += Math.min(comments.length * 2, 10);
  
  // 2. RECENCY SCORE (0-15 points)
  let recentScore = 0;
  for (const comment of comments) {
    const commentDate = new Date(comment.comment_date || 0);
    const daysAgo = (now - commentDate) / (1000 * 60 * 60 * 24);
    
    if (daysAgo < 7) recentScore += 5;
    else if (daysAgo < 30) recentScore += 3;
    else if (daysAgo < 90) recentScore += 1;
  }
  score += Math.min(recentScore, 15);
  
  // 3. QUALITY SCORE (0-10 points)
  let qualityScore = 0;
  let totalLength = 0;
  
  for (const comment of comments) {
    const text = comment.comment_text || '';
    totalLength += text.length;
    
    if (text.length > 100) qualityScore += 3;
    else if (text.length > 50) qualityScore += 2;
    else if (text.length > 20) qualityScore += 1;
  }
  score += Math.min(qualityScore, 10);
  
  // 4. PATTERN SCORE (0-10 points)
  let patternScore = 0;
  
  for (const comment of comments) {
    const text = comment.comment_text || '';
    if (text.includes('?')) patternScore += 2;
    if (/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(text)) patternScore += 1;
    if (text.includes('!')) patternScore += 1;
    if (text.includes('@')) patternScore += 1;
  }
  score += Math.min(patternScore, 10);
  
  // 5. AVERAGE LENGTH BONUS (0-5 points)
  const avgLength = totalLength / comments.length;
  if (avgLength > 100) score += 5;
  else if (avgLength > 50) score += 3;
  else if (avgLength > 20) score += 1;
  
  // Return score and level for testing
  let level;
  if (score >= 25) level = 'HIGH';
  else if (score >= 12) level = 'MEDIUM';
  else level = 'LOW';
  
  return { level, score };
}

// Test cases
console.log('📊 TESTS DE L\'ALGORITHME D\'ENGAGEMENT\n');

// Scenario 1: One short emoji comment (typical Instagram)
const scenario1 = [
  { comment_text: '🔥', comment_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }
];
console.log('Scénario 1: Un seul emoji récent');
console.log('Commentaire:', scenario1[0].comment_text);
console.log('Résultat:', calculateEngagementScore(scenario1));
console.log('');

// Scenario 2: Multiple short comments
const scenario2 = [
  { comment_text: 'Cool! 😎', comment_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) },
  { comment_text: 'Nice 👍', comment_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
  { comment_text: 'Love it ❤️', comment_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) }
];
console.log('Scénario 2: Plusieurs commentaires courts avec emojis');
console.log('Nb commentaires:', scenario2.length);
console.log('Résultat:', calculateEngagementScore(scenario2));
console.log('');

// Scenario 3: One long, detailed comment with question
const scenario3 = [
  { 
    comment_text: 'Hey! I love your content. How did you get started with this? I\'d love to learn more about your process! 🙏',
    comment_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  }
];
console.log('Scénario 3: Un commentaire long et détaillé avec question');
console.log('Longueur:', scenario3[0].comment_text.length, 'caractères');
console.log('Résultat:', calculateEngagementScore(scenario3));
console.log('');

// Scenario 4: Conversation (multiple long comments)
const scenario4 = [
  { 
    comment_text: 'This is amazing! How long did this take you? I want to try this approach too 😊',
    comment_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  },
  { 
    comment_text: '@yourpage Thanks for the tips! Really helpful content as always 🙌',
    comment_date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
  },
  { 
    comment_text: 'Just tried this and it worked perfectly! You\'re the best! 🔥',
    comment_date: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
  },
  { 
    comment_text: 'Can\'t wait for your next post!',
    comment_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
  }
];
console.log('Scénario 4: Conversation active (4 commentaires longs et engagés)');
console.log('Nb commentaires:', scenario4.length);
console.log('Résultat:', calculateEngagementScore(scenario4));
console.log('');

// Scenario 5: Old, inactive user
const scenario5 = [
  { comment_text: 'Nice', comment_date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) }
];
console.log('Scénario 5: Vieux commentaire (4 mois)');
console.log('Résultat:', calculateEngagementScore(scenario5));
console.log('');

console.log('✅ Tests terminés!\n');
console.log('📝 RÉSUMÉ:');
console.log('- HIGH (≥25 pts): Prospects très engagés, conversations actives');
console.log('- MEDIUM (≥12 pts): Engagement modéré, plusieurs interactions');
console.log('- LOW (<12 pts): Faible engagement, peu d\'interactions\n');
