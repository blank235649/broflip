import TwoUpGame from "./components/TwoUpGame";

export default function Home() {
  return (
    <>
    <main className="flex flex-1 w-full justify-center px-3 py-6 sm:px-6 lg:px-10">
      <div className="w-full max-w-7xl">
        <TwoUpGame />
      </div>
    </main>
    </>
  );
}
