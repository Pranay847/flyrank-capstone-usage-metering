import { openDatabase } from './db.js';
import { BillingService } from './service.js';
export function seed(db) { const s=new BillingService(db); s.ensureTenant('demo','Demo Tenant'); s.ensureTenant('other','Isolated Tenant'); return {tenants:2,plan:'free'}; }
if(process.argv[1]?.endsWith('seed.js')) console.log(JSON.stringify(seed(openDatabase(process.env.DATABASE_PATH||'./data/metering.db'))));
