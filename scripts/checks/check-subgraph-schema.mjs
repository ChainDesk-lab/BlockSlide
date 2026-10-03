const SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cmqr4hmlpe3gy01upecld9jhu/subgraphs/blockslide-leaderboard/2.0.0/gn';

async function main() {
  // Try introspection query
  const introspectionQuery = `
    {
      __schema {
        types {
          name
          kind
          fields {
            name
            type {
              name
              kind
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: introspectionQuery }),
    });

    const data = await response.json();

    // Print all available query fields
    const queryType = data.data?.__schema?.types?.find(t => t.name === 'Query');
    if (queryType && queryType.fields) {
      console.log('Available Query Fields in Goldsky Subgraph:');
      console.log('─'.repeat(60));
      queryType.fields
        .filter(f => !f.name.startsWith('_'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(f => {
          console.log(`  ${f.name}`);
        });
    } else {
      console.log('Could not find Query type');
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
