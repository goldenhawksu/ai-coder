"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import type { Terminal } from "xterm";
import { useCodeStore } from "@/store/code";
import {
  Folder,
  File,
  Terminal as TerminalIcon,
  Code,
  Globe,
} from "lucide-react";
import type { TerminalWrapperProps } from "./TerminalWrapper";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import Preview from "./Preview";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import JSZip from "jszip";

type TabType = "code" | "preview";

interface FileTreeNode {
  name: string;
  type: "file" | "directory";
  path: string;
  children?: FileTreeNode[];
  isExpanded?: boolean;
}

const TerminalWrapper = dynamic<TerminalWrapperProps>(
  () => import("./TerminalWrapper"),
  { ssr: false }
);

const Workbench = () => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("code");
  const { webcontainer, files, isWebcontainerReady, serverUrl } =
    useCodeStore();
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (serverUrl) {
      setActiveTab("preview");
    }
  }, [serverUrl]);

  // 构建文件树
  useEffect(() => {
    const buildFileTree = (paths: string[]): FileTreeNode[] => {
      const root: Record<string, FileTreeNode> = {};

      // 首先创建所有目录节点
      paths.forEach((path) => {
        const parts = path.split("/");
        let currentPath = "";

        // 创建路径上的所有目录节点
        parts.forEach((part, index) => {
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          const isLast = index === parts.length - 1;

          if (!root[currentPath]) {
            root[currentPath] = {
              name: part,
              path: currentPath,
              type: isLast ? "file" : "directory",
              children: isLast ? undefined : [],
              isExpanded: false,
            };
          }
        });
      });

      // 构建树结构
      Object.keys(root).forEach((path) => {
        const parts = path.split("/");
        if (parts.length > 1) {
          const parentPath = parts.slice(0, -1).join("/");
          const parent = root[parentPath];
          if (parent && parent.children) {
            // 避免重复添加
            if (!parent.children.find((child) => child.path === path)) {
              parent.children.push(root[path]);
            }
          }
        }
      });

      // 返回顶层节点
      return Object.values(root).filter((node) => !node.path.includes("/"));
    };

    setFileTree(buildFileTree(Object.keys(files)));
  }, [files]);

  const toggleDirectory = (node: FileTreeNode) => {
    const updateNode = (nodes: FileTreeNode[]): FileTreeNode[] => {
      return nodes.map((n) => {
        if (n.path === node.path) {
          return { ...n, isExpanded: !n.isExpanded };
        }
        if (n.children) {
          return { ...n, children: updateNode(n.children) };
        }
        return n;
      });
    };
    setFileTree(updateNode(fileTree));
  };

  // 渲染文件树
  const renderFileTree = (nodes: FileTreeNode[]) => {
    return (
      <ul className="pl-4">
        {nodes.map((node) => (
          <li key={node.path} className="py-1">
            <div
              className={`flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded ${
                selectedFile === node.path ? "bg-blue-100" : ""
              }`}
              onClick={() => {
                if (node.type === "directory") {
                  toggleDirectory(node);
                } else {
                  setSelectedFile(node.path);
                }
              }}
            >
              {node.type === "directory" ? (
                <Folder className="w-4 h-4" />
              ) : (
                <File className="w-4 h-4" />
              )}
              <span>{node.name}</span>
            </div>
            {node.children && node.isExpanded && renderFileTree(node.children)}
          </li>
        ))}
      </ul>
    );
  };

  const handleTerminal = useCallback(
    async (term: Terminal) => {
      if (!webcontainer || !isWebcontainerReady) return;
      terminalRef.current = term;

      // 将终端实例保存到 store
      useCodeStore.getState().setTerminal(term);

      try {
        // 启动一个持久的 shell 会话
        const shellProcess = await webcontainer.spawn("sh", {
          terminal: {
            cols: term.cols,
            rows: term.rows,
          },
        });

        // 将终端输入发送到 shell
        const writer = shellProcess.input.getWriter();
        term.onData((data) => {
          writer.write(data);
        });

        // 将 shell 输出写入终端
        const writableStream = new WritableStream({
          write(data) {
            term.write(data);
          },
        });
        shellProcess.output.pipeTo(writableStream);

        // 处理终端大小变化
        term.onResize(({ cols, rows }) => {
          shellProcess.resize({
            cols,
            rows,
          });
        });
      } catch (error) {
        console.error("Failed to start shell:", error);
        term.write("\r\nFailed to start shell\r\n");
      }
    },
    [webcontainer, isWebcontainerReady]
  );

  const handleDownload = async () => {
    const zip = new JSZip();

    // Add all files to the zip
    Object.entries(files).forEach(([path, content]) => {
      zip.file(path, content);
    });

    // Generate the zip file
    const blob = await zip.generateAsync({ type: "blob" });

    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "project.zip";
    a.click();

    // Clean up
    URL.revokeObjectURL(url);
  };

  // 添加文件扩展名到语言的映射函数
  const getLanguageExtension = (filename: string) => {
    const ext = filename.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "js":
      case "jsx":
      case "ts":
      case "tsx":
        return javascript({ jsx: true, typescript: true });
      case "html":
        return html();
      case "css":
        return css();
      default:
        return javascript();
    }
  };

  const handlePanelResize = useCallback(() => {
    window.dispatchEvent(new Event("resize"));
  }, []);

  return (
    <div className="h-[800px] grid grid-cols-12 gap-4 bg-white rounded-xl border border-gray-200 p-4">
      {/* 文件浏览器 */}
      <div className="col-span-3 border-r border-gray-200 overflow-y-auto">
        <div className="font-semibold mb-4 flex items-center gap-2">
          <Folder className="w-5 h-5" />
          Files
        </div>
        {renderFileTree(fileTree)}
      </div>

      {/* 主内容区域 */}
      <div className="col-span-9 h-full">
        {/* 文件内容/预览 */}
        <div className="h-full border border-gray-200 rounded-lg overflow-hidden">
          <ResizablePanelGroup direction="vertical">
            {/* 代码编辑器 */}
            <ResizablePanel defaultSize={66}>
              <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as TabType)}
                className="h-full flex flex-col"
              >
                <div className="bg-gray-100 p-2">
                  <TabsList className="bg-transparent">
                    <TabsTrigger
                      value="code"
                      className="flex items-center gap-2 data-[state=active]:bg-white"
                    >
                      <Code className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        {selectedFile || "Editor"}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="preview"
                      className="flex items-center gap-2 data-[state=active]:bg-white"
                    >
                      <Globe className="w-4 h-4" />
                      <span className="text-sm font-medium">Preview</span>
                    </TabsTrigger>
                  </TabsList>
                  {/* download code button */}
                  <Button className="relative left-4" onClick={handleDownload}>
                    <Download className="w-4 h-4" />
                    Download
                  </Button>
                </div>
                {/* 代码编辑器/终端 */}
                <TabsContent value="code" className="m-0 h-full">
                  <div className="h-full w-full bg-gray-50">
                    {selectedFile && files[selectedFile] ? (
                      <CodeMirror
                        value={files[selectedFile]}
                        className="h-full w-full"
                        height="95%"
                        theme={oneDark}
                        extensions={[getLanguageExtension(selectedFile)]}
                        basicSetup={{
                          lineNumbers: true,
                          highlightActiveLineGutter: true,
                          highlightSpecialChars: true,
                          foldGutter: true,
                          drawSelection: true,
                          dropCursor: true,
                          allowMultipleSelections: true,
                          indentOnInput: true,
                          bracketMatching: true,
                          closeBrackets: true,
                          autocompletion: true,
                          rectangularSelection: true,
                          crosshairCursor: true,
                          highlightActiveLine: true,
                          highlightSelectionMatches: true,
                          closeBracketsKeymap: true,
                          defaultKeymap: true,
                          searchKeymap: true,
                          historyKeymap: true,
                          foldKeymap: true,
                          completionKeymap: true,
                          lintKeymap: true,
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400">
                        Select a file to view its contents
                      </div>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="preview" className="m-0 h-full">
                  <Preview serverUrl={serverUrl} />
                </TabsContent>
              </Tabs>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={34} onResize={handlePanelResize}>
              {/* 终端 */}
              <div className="h-full border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                <div className="bg-gray-100 p-2 flex items-center gap-2">
                  <TerminalIcon className="w-4 h-4" />
                  <span className="text-sm font-medium">Terminal</span>
                </div>
                {isWebcontainerReady && (
                  <div className="flex-1 h-full min-h-0">
                    <TerminalWrapper onTerminal={handleTerminal} />
                  </div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  );
};

export default Workbench;
