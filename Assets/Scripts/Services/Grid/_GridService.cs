// using System;
// using System.Collections.Generic;
// using System.Linq;
// using UnityEngine;
// using Core.Entities;
// using Cysharp.Threading.Tasks;
// using DG.Tweening;
// using Grid;
// using NUnit.Framework;
// using Random = UnityEngine.Random;
//
// namespace Services.Grid
// { 
//     /// <summary>
//     /// Отвечает за создание и управление игровым полем (сеткой),
//     /// а также за объекты, размещенные на этой сетке.
//     /// </summary>
//     public class GridService : MonoBehaviour
//     {
//         [Header("Grid Settings")]
//         [SerializeField] private int width = 9;
//         [SerializeField] private int height = 9;
//         [SerializeField] private float cellSize = 1f;
//         [SerializeField] private Color gridColor = Color.gray;
//         [SerializeField] private List<Entity> availableEntitiesList;
//
//         public static GridService Instance { get; private set; }
//         public Hero Hero => FindFirstObjectByType<Hero>();
//
//         /// <summary>
//         /// Список всех сущностей на поле (герой, враги, препятствия).
//         /// Можно разделить на несколько списков при необходимости.
//         /// </summary>
//         private readonly List<Entity> _entities = new();
//
//         /// <summary>
//         /// Массив клеток. Размер width x height.
//         /// </summary>
//         private Cell[,] _cells;
//
//         private void Awake() {
//             if (Instance == null) {
//                 Instance = this;
//                 DontDestroyOnLoad(gameObject);
//             } else {
//                 Destroy(gameObject);
//             }
//         }
//         
//         private void OnEnable()
//         {
//             Entity.OnDie += RemoveEntity;
//         }
//
//         private void OnDisable()
//         {
//             Entity.OnDie -= RemoveEntity;
//         }
//
//         private void OnDrawGizmos()
//         {
//             Gizmos.color = gridColor;
//
//             // Горизонтальные линии
//             for (var y = 0; y <= height; y++)
//             {
//                 Gizmos.DrawLine(
//                     new Vector3(0, y * cellSize, 0),
//                     new Vector3(width * cellSize, y * cellSize, 0)
//                 );
//             }
//
//             // Вертикальные линии
//             for (var x = 0; x <= width; x++)
//             {
//                 Gizmos.DrawLine(
//                     new Vector3(x * cellSize, 0, 0),
//                     new Vector3(x * cellSize, height * cellSize, 0)
//                 );
//             }
//         }
//         
//         private void PopulateCellsFromScene()
//         {
//             // Ищем все объекты типа Entity в сцене
//             var foundCells = FindObjectsByType<Cell>(FindObjectsSortMode.None);
//
//             foreach (var cell in foundCells)
//             {
//                 _cells[cell.Position.x, cell.Position.y] = cell;
//             }
//         }
//         
//         private void PopulateEntitiesFromScene()
//         {
//             // Ищем все объекты типа Entity в сцене
//             var foundEntities = FindObjectsByType<Entity>(FindObjectsSortMode.None);
//
//             foreach (var entity in foundEntities)
//             {
//                 if (IsInsideGrid(entity.Cell.Position))
//                 {
//                     _entities.Add(entity);
//                 }
//                 else
//                 {
//                     Debug.LogWarning($"Entity {entity.name} is outside the grid bounds!");
//                 }
//             }
//         }
//         
//         
//         public void Init()
//         {
//             _cells = new Cell[width, height];
//
//             PopulateCellsFromScene();
//             PopulateEntitiesFromScene();
//             SpawnEntitiesOnGrid();
//         }
//
//         public Enemy[] GetEnemies()
//         {
//             return _entities.OfType<Enemy>().ToArray();
//         }
//         
//         public void SpawnEntitiesOnGrid()
//         {
//             foreach (var cell in _cells)
//             {
//                 // Выбираем случайного противника из entitiesList
//                 var randomEnemy = availableEntitiesList[Random.Range(0, availableEntitiesList.Count)];
//                 var isCellEmpty = GetEntityAt(cell.Position) == null;
//                 
//                 // Проверяем, что ячейка не заблокирована и не занята
//                 if (cell == null || !cell.IsAvailableForEntity() || !isCellEmpty) continue;
//                 
//                 var newEntity = Instantiate(randomEnemy);
//
//                 newEntity.SetCell(cell, true);
//
//                 _entities.Add(newEntity);
//             }
//
//             
//             Debug.Log($"Field populated with enemies: {_entities.Count}");
//         }
//
//         public bool IsInsideGrid(Vector2Int position)
//         {
//             return (position.x >= 0 && position.x < width && position.y >= 0 && position.y < height);
//         }
//
//         public Cell GetCell(int x, int y)
//         {
//             return IsInsideGrid(new Vector2Int(x, y)) ? _cells[x, y] : null;
//         }
//         
//         public bool IsCellWalkable(int x, int y)
//         {
//             if (!IsInsideGrid(new Vector2Int(x, y))) return false;
//
//             var cell = _cells[x, y];
//             // Ловушка (Trap) может быть проходимой, а Blocked — нет, Destructible — на усмотрение
//             return (cell.Type != CellType.Blocked);
//         }
//         
//         public Entity GetEntityAt(Vector2Int position)
//         {
//             return _entities.FirstOrDefault(e => e.Cell.Position == position);
//         }
//
//         public void RemoveEntity(Entity entity)
//         {
//             if (_entities.Contains(entity))
//             {
//                 _entities.Remove(entity);
//             }
//         }
//         
//         public async UniTask ApplyGravity()
//         {
//             var tasks = new List<UniTask>();
//             
//             for (var x = 0; x < _cells.GetLength(0); x++) // Проходим по всем столбцам
//             {
//                 for (var y = 0; y < _cells.GetLength(1); y++) // Проходим по строкам снизу вверх
//                 {
//                     var cell = _cells[x, y];
//                     var entity = GetEntityAt(cell.Position);
//                     if (!entity || entity.Type == EntityType.Hero) continue; // Герой не падает
//                     
//                     var targetCell = _getLowestAvailableCell(cell);
//                     if (targetCell == null) continue;
//
//                     var move = entity.Move(targetCell).ToUniTask();
//
//                     // Добавляем анимацию в последовательность
//                     tasks.Add(move);
//                 }
//             }
//
//             await UniTask.WhenAll(tasks);
//         }
//         
//         public List<Cell> GetNeighborsCell(Cell cell) {
//             var neighbors = new List<Cell>();
//
//             // Проходим по всем 8 направлениям
//             for (var x = -1; x <= 1; x++) {
//                 for (var y = -1; y <= 1; y++) {
//                     if (x == 0 && y == 0)
//                         continue; // пропускаем саму клетку
//
//                     var neighborCell = GetCell(cell.Position.x + x, cell.Position.y + y);
//
//                     if (neighborCell == null) continue;
//
//                     // Проверяем, что сосед в пределах поля
//                     if (neighborCell.Position.x >= 0 && neighborCell.Position.x < width && neighborCell.Position.y >= 0 && neighborCell.Position.y < height) {
//                         if (neighborCell.Type == CellType.Blocked) continue;
//
//                         neighbors.Add(neighborCell);
//                     }
//                 }
//             }
//
//             return neighbors;
//         }
//
//         public void SpawnEntity(Entity entity, Cell cell)
//         {
//             var entityOnCell = GetEntityAt(cell.Position);
//
//             if (entityOnCell)
//             {
//                 entityOnCell.Die();
//             }
//
//             var newEntity = Instantiate(entity);
//             _entities.Add(newEntity);
//             newEntity.SetCell(cell, true);
//         }
//
//         private Cell _getLowestAvailableCell(Cell startCell)
//         {
//             for (var y = 0; y < startCell.Position.y; y++) // Проходим снизу вверх до текущей ячейки
//             {
//                 var potentialCell = GetCell(startCell.Position.x, y);
//                 if (potentialCell == null) continue;
//
//                 var entityInPotentialCell = GetEntityAt(potentialCell.Position);
//
//                 if (potentialCell != null && potentialCell.IsAvailableForEntity() && entityInPotentialCell == null)
//                 {
//                     return potentialCell; // Возвращаем самую нижнюю доступную ячейку
//                 }
//             }
//
//             return null; // Если доступных ячеек нет, возвращаем null
//         }
//
//         private void _updateGrid(GameState gameState)
//         {
//             if (gameState == GameState.UpdateGrid)
//             {
//                 
//             }
//         }
//     }
// }