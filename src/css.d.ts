/**
 * 让 `import './x.css'` 通过类型检查。
 *
 * 打包器（vite）认识这种导入并把它变成一个 <style> 或一份产物里的样式表，
 * 但 tsc 不认识，会报 TS2307。声明成无导出的模块即可 - 这种导入只有副作用，
 * 从来不取值。
 *
 * 这个文件必须没有顶层 import/export，否则它会变成一个普通模块，
 * 里面的 declare module 就不再是全局声明了。
 */
declare module '*.css';
