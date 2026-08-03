export const metadata = {
  title: '哈希最后5个数字｜每段双选形态优化系统',
  description: '提取哈希最后5个数字，前三、中三、后三各预测两个形态，并进行冻结回测',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
