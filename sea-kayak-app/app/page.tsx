"use client"

import { useState, useEffect, useRef } from "react"
import { motion } from "framer-motion"
import "./globals.css"

export default function Home() {
  const [routes, setRoutes] = useState<string[]>([])
  const [randomUrl, setRandomUrl] = useState("#")
  const infoSectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Fetch routes from GitHub
    fetch("https://raw.githubusercontent.com/gongahkia/sea-kayak/main/data/routes.json")
      .then(response => response.json())
      .then(data => {
        type RouteItem = { url: string }
        const routesArray = Array.isArray(data) ? 
          (typeof data[0] === 'string' ? data : data.map((item: RouteItem) => item.url)) : []
        setRoutes(routesArray)
        if (routesArray.length > 0) {
          setRandomUrl(routesArray[Math.floor(Math.random() * routesArray.length)])
        }
      })
      .catch(console.error)

    // Mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY })
    }

    // Wheel scrolling
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY > 0) {
        infoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
      } else if (e.deltaY < 0) {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("wheel", handleWheel)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("wheel", handleWheel)
    }
  }, [])

  const handleHover = () => {
    if (routes.length > 0) {
      setRandomUrl(routes[Math.floor(Math.random() * routes.length)])
    }
    setIsHovering("paddle")
  }

  const scrollToInfo = () => {
    infoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden snap-y snap-mandatory">
      {/* Main buttons section */}
      <section className="h-screen flex items-center justify-center bg-gradient-to-b from-sky-100 via-sky-200 to-cyan-200 text-sky-900 snap-start">
        <div className="flex flex-col items-center gap-8 relative z-10">
          <a
            href={randomUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-[400px]"
          >
            <div className="neobrutalist-button-container">
              <motion.div
                id="paddle"
                className="neobrutalist-button w-full h-16 bg-white text-black border-4 border-black rounded-lg font-bold text-lg tracking-wider relative overflow-hidden cursor-pointer"
                initial={{ x: -8, y: -8 }}
                whileHover={{ x: -4, y: -4 }}
                whileTap={{ x: 0, y: 0 }}
                animate={{ x: -8, y: -8 }}
                onMouseEnter={handleHover}
                onMouseLeave={() => setIsHovering(null)}
              >
                <div className="absolute inset-0 flex items-center justify-center z-10">PADDLE THE OCEAN</div>
              </motion.div>
              <div className="neobrutalist-button-shadow"></div>
            </div>
          </a>

          <div className="neobrutalist-button-container" style={{ width: "140px" }}>
            <motion.button
              id="info"
              className="neobrutalist-button w-full h-16 bg-white text-black border-4 border-black rounded-lg font-bold text-lg tracking-wider relative overflow-hidden cursor-pointer"
              initial={{ x: -8, y: -8 }}
              whileHover={{ x: -4, y: -4 }}
              whileTap={{ x: 0, y: 0 }}
              animate={{ x: -8, y: -8 }}
              onClick={scrollToInfo}
              onMouseEnter={() => setIsHovering("info")}
              onMouseLeave={() => setIsHovering(null)}
            >
              <div className="absolute inset-0 flex items-center justify-center z-10">INFO</div>
            </motion.button>
            <div className="neobrutalist-button-shadow"></div>
          </div>
        </div>
      </section>

      {/* Info Section */}
      <section
        ref={infoSectionRef}
        className="h-screen flex flex-col items-center justify-center bg-gradient-to-b from-cyan-200 via-sky-300 to-blue-200 text-sky-900 relative snap-start"
      >
        <div className="max-w-2xl text-align-left space-y-6">
          <p className="text-300 mb-6">
            The internet was supposed to make our lives easier.
            <br></br>
            <br></br>
            Yet, there is just too much noise out there these days.
            <br></br>
            <br></br>
            Navigating the modern web for <i>timely</i> legal news has 
            <br></br>
            become an unnecessarily daunting task.
            <br></br>
            <br></br>
            This site is my attempt to restore some sanity to the web.
            <br></br>
            <br></br>
            Have a good time out there, Sea Kayaker.
            <br></br>
            <br></br>
            ~ <a href="https://gabrielongzm.com" className="text-indigo-500 hover:underline">Gabriel</a>
          </p>
        </div>

        {/* Footer */}
        <div className="absolute bottom-8 text-sm text-400 text-center">
          <p>
            Source code{" "}
            <a
              href="https://github.com/gongahkia/sea-kayak"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-400 hover:underline"
            >
              here
            </a>
            .
          </p>
          <p className="mt-4 text-xs">© 2025 Sea Kayak. All rights reserved.</p>
        </div>
      </section>
    </div>
  )
}