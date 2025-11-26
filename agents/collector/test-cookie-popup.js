#!/usr/bin/env node

/**
 * Test Cookie Popup Detection
 * 
 * Ce script teste la détection et la gestion du popup de cookies Instagram.
 * Il simule l'ouverture de la page de login et tente de fermer le popup.
 */

import { chromium } from 'playwright';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testCookiePopup() {
  console.log('🧪 Test de détection du popup de cookies Instagram\n');
  
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500 // Ralentit les actions pour visualisation
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    console.log('1️⃣ Navigation vers Instagram login...');
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    await delay(3000);
    
    console.log('\n2️⃣ Recherche du popup de cookies...\n');
    
    // Liste des sélecteurs à tester
    const cookieSelectors = [
      { selector: 'button:has-text("Allow all cookies")', desc: 'Text: "Allow all cookies"' },
      { selector: 'button:has-text("Autoriser tous les cookies")', desc: 'Text: "Autoriser tous les cookies"' },
      { selector: 'button._a9--._ap36._asz1', desc: 'Class: ._a9--._ap36._asz1' },
      { selector: 'button:has-text("Accept")', desc: 'Text: "Accept"' },
      { selector: 'button:has-text("Accepter")', desc: 'Text: "Accepter"' },
    ];
    
    let buttonFound = null;
    let foundSelector = null;
    
    for (const { selector, desc } of cookieSelectors) {
      try {
        console.log(`   → Trying: ${desc}`);
        const button = await page.$(selector);
        
        if (button) {
          const isVisible = await button.isVisible();
          console.log(`     ✅ Found! Visible: ${isVisible}`);
          
          if (isVisible && !buttonFound) {
            buttonFound = button;
            foundSelector = desc;
          }
        } else {
          console.log(`     ❌ Not found`);
        }
      } catch (e) {
        console.log(`     ⚠️  Error: ${e.message}`);
      }
    }
    
    if (buttonFound) {
      console.log(`\n3️⃣ Popup détecté ! Clic sur le bouton...`);
      console.log(`   Using selector: ${foundSelector}`);
      
      try {
        // Essai 1 : Clic normal
        console.log('   → Attempting normal click...');
        await buttonFound.click({ timeout: 3000 });
        console.log('     ✅ Normal click successful');
      } catch (clickErr) {
        // Essai 2 : Force click
        console.log('   → Normal click failed, trying force click...');
        try {
          await buttonFound.click({ force: true });
          console.log('     ✅ Force click successful');
        } catch (forceErr) {
          console.log('     ❌ Force click failed');
        }
      }
      
      await delay(2000);
      
      // Vérifier que le popup a disparu
      const stillVisible = await buttonFound.isVisible().catch(() => false);
      if (!stillVisible) {
        console.log('\n   ✅ Popup fermé avec succès !');
      } else {
        console.log('\n   ⚠️  Popup toujours visible, essai de la méthode JavaScript...');
        
        const jsClicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const cookieButton = buttons.find(btn => 
            btn.textContent.includes('Allow all cookies') ||
            btn.textContent.includes('Autoriser tous les cookies') ||
            btn.textContent.includes('Accept') ||
            btn.textContent.includes('Accepter')
          );
          
          if (cookieButton) {
            cookieButton.click();
            return true;
          }
          return false;
        });
        
        if (jsClicked) {
          console.log('     ✅ JavaScript click successful');
          await delay(2000);
        } else {
          console.log('     ❌ JavaScript click failed');
        }
      }
      
    } else {
      console.log('\n   ⚠️  Aucun popup de cookies détecté');
      console.log('   (Il a peut-être déjà été accepté dans ce navigateur)');
    }
    
    console.log('\n4️⃣ Vérification du formulaire de login...');
    const usernameInput = await page.$('input[name="username"]');
    if (usernameInput) {
      console.log('   ✅ Formulaire de login visible !');
    } else {
      console.log('   ❌ Formulaire de login non trouvé');
    }
    
    console.log('\n✅ Test terminé ! Le navigateur reste ouvert pour inspection.');
    console.log('   Appuie sur ENTER pour fermer...\n');
    
    // Wait for user input
    const { createInterface } = await import('readline');
    await new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('', () => {
        rl.close();
        resolve();
      });
    });
    
  } catch (error) {
    console.error('\n❌ Erreur:', error.message);
  } finally {
    await browser.close();
  }
}

// Run test
testCookiePopup().catch(console.error);
