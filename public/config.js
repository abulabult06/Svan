// Safe to expose in the browser — this is the public anon key, and Supabase
// Row Level Security only allows read access with it (writes need the secret
// service role key, which lives only in Netlify's server-side environment).
window.SCANNER_CONFIG = {
  SUPABASE_URL: "https://qkrilzvypcetbztwdwaj.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrcmlsenZ5cGNldGJ6dHdkd2FqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NjExNzEsImV4cCI6MjA5NzIzNzE3MX0.UxrzOryEhfxipBvdEL4Cu56LdLbByzcETbBoyjWHgZY"
};
