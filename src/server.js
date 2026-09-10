import { createApp } from './app.js';
const port=Number(process.env.PORT||3300); createApp().server.listen(port,()=>console.log(JSON.stringify({level:'info',message:'listening',port})));
