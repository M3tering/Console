"use client";
import "./global.css";
import "nes.css/css/nes.min.css";
import Image from "next/image";
import { ethers } from "ethers";
import { useState, useRef } from "react";

let signer;
let provider;
var date = new Date();
let meterData: string[] = new Array(15);
meterData.fill("");

export default function Home() {
  const clickRef = useRef<HTMLAudioElement>(null);
  const [isConnected, setConnection] = useState(false);
  const [isOpen, setOpen] = useState(false);

  const isBrowser = () => typeof window !== "undefined";

  function toggleApp(appIds: string[]) {
    if (clickRef.current) clickRef.current.play();
    var state = isOpen;
    var scroll = document.getElementById("scroll");
    appIds.forEach((appId) => {
      var app = document.getElementById(appId);
      if (!app || !scroll) return console.log(`${appId} not closed`);
      if (state) {
        app.style.display = "none";
        scroll.style.display = "none";
        console.log(`${appId} closed`);
        state = false;
      } else {
        app.style.display = "block";
        scroll.style.display = "block";
        console.log(`${appId} opened`);
        state = true;
      }
    });
    setOpen(state);
  }

  function scrollToTop() {
    if (!isBrowser()) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div>
      <div id="nav">
        &#8192;&#8192;&#8192;&#8192;&#8192;&#8192;
        <span>File</span>&#8192;&#8192;&#8192;&#8192;&#8192;&#8192;
        <span>Edit</span>&#8192;&#8192;&#8192;&#8192;&#8192;&#8192;
        <span>Help</span>
        <div className="bbtn">
          {date.toLocaleTimeString()}&#8192;&#8192;&#8192;&#8192;&#8192;&#8192;
        </div>
      </div>
      <div>
        {/* Apps */}
        <div className="nes-container subtle">
          <div>
            {/* M3ters Icon */}
            <div>
              <div>
                {isOpen ? (
                  ""
                ) : (
                  <div>
                    <button
                      className="nes-btn"
                      style={{ backgroundColor: "#eee" }}
                      onClick={(x) => toggleApp(["m3ters"])}
                    >
                      <div>
                        <Image
                          alt="Welcome"
                          width={60}
                          height={60}
                          src={
                            "https://mqtt-node.vercel.app/api/m3ter-head/pretty"
                          }
                          className="nes-avatar"
                        />
                        <Image
                          alt="Welcome"
                          width={60}
                          height={60}
                          src={
                            "https://mqtt-node.vercel.app/api/m3ter-head/new"
                          }
                          className="nes-avatar"
                        />
                      </div>
                      <div>
                        <Image
                          alt="Welcome"
                          width={60}
                          height={60}
                          src={
                            "https://mqtt-node.vercel.app/api/m3ter-head/blob"
                          }
                          className="nes-avatar"
                        />
                        <Image
                          alt="Welcome"
                          width={60}
                          height={60}
                          src={
                            "https://mqtt-node.vercel.app/api/m3ter-head/now"
                          }
                          className="nes-avatar"
                        />
                      </div>
                    </button>
                    <p>M3ters</p>
                  </div>
                )}
              </div>
            </div>

            {/* Github Icon */}
            <div>
              {isOpen ? (
                ""
              ) : (
                <div style={{ float: "right" }}>
                  <a
                    className="nes-btn is-warning"
                    target="browser"
                    onClick={(x) => {
                      toggleApp(["browser"]);
                    }}
                    href="https://basepaint.xyz/"
                  >
                    <i className="nes-icon heart is-medium"></i>
                  </a>
                  <p>Paint</p>
                </div>
              )}
            </div>

            {/* Terminal Icon */}
            <div>
              {isOpen ? (
                ""
              ) : (
                <div>
                  <button
                    className="nes-btn is-success"
                    style={{ backgroundColor: "black" }}
                    onClick={(x) => {
                      toggleApp(["console"]);
                      startDataStream();
                    }}
                  >
                    <h1 style={{ fontSize: 26 }}>&gt;_</h1>
                  </button>
                  <p>console</p>
                </div>
              )}
            </div>

            {/* Browser Icon */}
            <div>
              {isOpen ? (
                ""
              ) : (
                <div style={{ float: "right" }}>
                  <button
                    className="nes-btn"
                    onClick={(x) => {
                      toggleApp(["browser"]);
                    }}
                  >
                    <i className="nes-icon google is-medium"></i>{" "}
                  </button>
                  <p>browse</p>
                </div>
              )}
            </div>

            {/* M3ters Table */}
            <div
              className="nes-table-responsive nes-container hidden"
              id="m3ters"
              style={{
                backgroundColor: "white",
                float: "left",
              }}
            >
              <div>
                <button
                  className="nes-btn is-error"
                  onClick={(x) => toggleApp(["m3ters"])}
                >
                  <i className="nes-icon close is-small"></i>
                </button>
                <button
                  className="nes-btn"
                  onClick={(x) => toggleApp(["m3ters"])}
                >
                  _
                </button>
              </div>
              <div className="nes-field is-inline">
                <input
                  type="text"
                  id="tokenId_input"
                  className="nes-input"
                  placeholder="tokenId"
                />
                <button
                  type="button"
                  className="nes-btn is-warning"
                  onClick={getProvider}
                >
                  + Add M3ter
                </button>
                <label>
                  <input
                    type="checkbox"
                    className="nes-checkbox"
                    defaultChecked={false}
                  />
                  <span>sudo</span>
                </label>
              </div>
              <table className="nes-table is-bordered">
                <thead className="nes-container is-centered">
                  <tr>
                    <th>TokenId</th>
                    <th>Warp Contract</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={
                          "https://mqtt-node.vercel.app/api/m3ter-head/strange"
                        }
                      />
                      <span> #3</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/new"}
                      />
                      <span> #4</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={
                          "https://mqtt-node.vercel.app/api/m3ter-head/world"
                        }
                      />
                      <span> #5</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/nice"}
                      />
                      <span> #6</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={
                          "https://mqtt-node.vercel.app/api/m3ter-head/crazy"
                        }
                      />
                      <span> #7</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/moon"}
                      />
                      <span> #8</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/odd"}
                      />
                      <span> #9</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/old"}
                      />
                      <span> #10</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={
                          "https://mqtt-node.vercel.app/api/m3ter-head/space"
                        }
                      />
                      <span> #11</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/fine"}
                      />
                      <span> #12</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/man"}
                      />
                      <span> #13</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/mars"}
                      />
                      <span> #14</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/cool"}
                      />
                      <span> #15</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={"https://mqtt-node.vercel.app/api/m3ter-head/song"}
                      />
                      <span> #16</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <Image
                        className="nes-avatar is-medium"
                        alt="m3ter-head avatar"
                        width={100}
                        height={100}
                        src={
                          "https://mqtt-node.vercel.app/api/m3ter-head/earth"
                        }
                      />
                      <span> #17</span>
                    </td>
                    <td>
                      <a
                        target="browser"
                        onClick={(x) => {
                          toggleApp(["m3ters", "browser"]);
                        }}
                        href="https://sonar.warp.cc/#/app/contract/bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec?network=mainnet&dre=dre1"
                      >
                        bI0xZfhTbn6Na4UFARhHFKbbHVZ4FJlKqqaPD8cQRec
                      </a>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* console Terminal */}
            <div className="nes-container is-dark hidden" id="console">
              <button
                className="nes-btn is-error"
                onClick={(x) => toggleApp(["console"])}
              >
                <i className="nes-icon close is-small"></i>
              </button>
              <button
                className="nes-btn"
                onClick={(x) => toggleApp(["console"])}
              >
                _
              </button>
              <div className="nes-container is-dark" id="m3ter-data">
                <div className="nes-container is-dark is-centered subtle">
                  <h3 className="empty">Loading M3ter data...</h3>
                </div>
              </div>
              <span></span>
            </div>
          </div>
        </div>

        {/* google app */}
        <div className="nes-container subtle hidden" id="browser">
          <div className="nes-container" style={{ backgroundColor: "white" }}>
            <button
              className="nes-btn is-error"
              onClick={(x) => toggleApp(["browser"])}
            >
              <i className="nes-icon close is-small"></i>
            </button>
            <button className="nes-btn" onClick={(x) => toggleApp(["browser"])}>
              _
            </button>
            <iframe
              src="https://www.wikipedia.org/"
              name="browser"
              title="Google search"
            ></iframe>
          </div>
        </div>

        <button
          type="button"
          id="scroll"
          className="nes-btn"
          onClick={scrollToTop}
          style={{
            display: "none",
            position: "fixed",
            bottom: 70,
            right: 70,
            zIndex: 99,
          }}
        >
          <span>&#x2191;</span>
        </button>
        <audio ref={clickRef} src={"/rclick-13693.mp3"} />
      </div>
    </div>
  );
}
