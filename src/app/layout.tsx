import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'HireFlow AI — Recruiting workspace',description:'A focused recruitment workspace. Thoughtful hiring, human decisions.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
