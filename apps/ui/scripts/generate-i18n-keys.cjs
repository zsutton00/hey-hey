#!/usr/bin/env node

/**
 * Generates TypeScript constants from i18n JSON files
 * Run with: node scripts/generate-i18n-keys.js
 */

const fs = require('fs');
const path = require('path');

function flattenObject(obj, prefix = '') {
  const flattened = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(flattened, flattenObject(value, newKey));
    } else {
      flattened[newKey] = newKey;
    }
  }
  
  return flattened;
}

function createNestedObject(flatObj) {
  const nested = {};
  
  for (const [path, value] of Object.entries(flatObj)) {
    const keys = path.split('.');
    let current = nested;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }
    
    const lastKey = keys[keys.length - 1];
    current[lastKey] = `"${value}" as const`;
  }
  
  return nested;
}

function objectToString(obj, indent = 0) {
  const spaces = '  '.repeat(indent);
  const entries = Object.entries(obj).map(([key, value]) => {
    if (typeof value === 'object') {
      return `${spaces}  ${key}: {\n${objectToString(value, indent + 1)}\n${spaces}  }`;
    } else {
      return `${spaces}  ${key}: ${value}`;
    }
  });
  
  return entries.join(',\n');
}

try {
  // Read the main locale file (TypeScript)
  const localeFile = path.join(__dirname, '../src/i18n/locales/en.ts');
  const fileContent = fs.readFileSync(localeFile, 'utf8');
  
  // Extract the object from the TypeScript export
  // This is a simple regex approach - for production you might want a proper AST parser
  const objectMatch = fileContent.match(/export const en = ({[\s\S]*?}) as const;/);
  if (!objectMatch) {
    throw new Error('Could not find en export in TypeScript file');
  }
  
  // Convert to valid JSON by using eval (note: this is safe here since it's our own code)
   
  const localeData = eval(`(${objectMatch[1]})`);
  
  // Flatten and recreate nested structure
  const flattened = flattenObject(localeData);
  const nested = createNestedObject(flattened);
  
  // Generate TypeScript file
  const tsContent = `/**
 * Auto-generated i18n keys from en.json
 * DO NOT EDIT MANUALLY - Run 'npm run generate-i18n-keys' to regenerate
 * 
 * Usage: t(I18N_KEYS.onboarding.subtitle)
 * Benefits: Command+click navigation, autocomplete, type safety
 */

export const I18N_KEYS = {
${objectToString(nested, 0)}
} as const;

// Type helper for autocomplete
export type I18nKey = typeof I18N_KEYS;

// Extract all possible key paths as a union type
type ExtractKeys<T, K extends keyof T = keyof T> = K extends string
  ? T[K] extends Record<string, any>
    ? \`\${K}.\${ExtractKeys<T[K]>}\`
    : K
  : never;

export type I18nKeyPath = ExtractKeys<typeof I18N_KEYS>;
`;

  // Write the generated file
  const outputFile = path.join(__dirname, '../src/i18n/keys.ts');
  fs.writeFileSync(outputFile, tsContent);
  
  console.log('✅ Generated i18n keys successfully!');
  console.log(`📝 Generated ${Object.keys(flattened).length} translation keys`);
  console.log(`📁 Output: ${outputFile}`);
  
} catch (error) {
  console.error('❌ Error generating i18n keys:', error.message);
  process.exit(1);
}