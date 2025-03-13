using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Entities;
using Cysharp.Threading.Tasks;
using Entities.Enemies;
using Entities.Player;
using Unity.VisualScripting;
using UnityEngine.Tilemaps;
using Random = UnityEngine.Random;

namespace Grid
{ 
    /// <summary>
    /// Отвечает за создание и управление игровым полем (сеткой),
    /// а также за объекты, размещенные на этой сетке.
    /// </summary>
    public class GridService : MonoBehaviour
    {
        [Header("Grid Settings")]
        [SerializeField] private Tilemap groundTilemap;
        [SerializeField] private Tilemap obstacleTilemap;
        [SerializeField] private List<BaseEntity> availableEntitiesList = new();
        
        // private int width;
        // private int height;
        
        private SpawnService _spawnService;

        // private Cell[,] _cells;
        
        public void Init()
        {
            // var bounds = groundTilemap.cellBounds;
            // width = bounds.xMax;
            // height = bounds.yMax;
            // _cells = new Cell[width, height];
            _spawnService = new SpawnService(availableEntitiesList);

            // _populateCellsFromScene();
        }

        public List<T> GetEntitiesOfType<T>() where T : BaseEntity
        {
            return _spawnService.GetSpawnedEntities().OfType<T>().ToList();
        }
        
        public List<Enemy> GetEnemies()
        {
            return GetEntitiesOfType<Enemy>();
        }

        public void SpawnEntitiesOnGrid()
        {
            var bounds = groundTilemap.cellBounds;

            foreach (var cellPos in bounds.allPositionsWithin)
            {
                // Проверяем, что в клетке есть земля И нет препятствия
                if (groundTilemap.HasTile(cellPos) && !obstacleTilemap.HasTile(cellPos))
                {
                    // Переводим координаты сетки в координаты мира
                    var worldPosition = groundTilemap.CellToWorld(cellPos);
                    var isCellEmpty = GetEntityAt(worldPosition) == null;

                    if (!isCellEmpty) continue;
                    
                    _spawnService.SpawnEntity(worldPosition);
                }
            }
        }

        // public bool IsInsideGrid(Vector2Int position)
        // {
        //     return (position.x >= 0 && position.x < width && position.y >= 0 && position.y < height);
        // }

        public Vector3? GetCell(int x, int y)
        {
            var cellPosition = groundTilemap.WorldToCell(new Vector3Int(x, y, 0));
            var tile = groundTilemap.GetTile(cellPosition);
            
            return tile ? cellPosition : null;
        }
        
        public BaseEntity GetEntityAt(Vector3 position)
        {
            return _spawnService.GetSpawnedEntities().Where(e => !e.Health.IsDead).FirstOrDefault(e => e.GridPosition == position);
        }
        
        public BaseEntity SpawnEntity(BaseEntity baseEntity, Vector3Int position)
        {
            return _spawnService.SpawnEntityOnCell(baseEntity, position);
        }
        
        public async UniTask ApplyGravity()
        {
            var bounds = groundTilemap.cellBounds;
            var width = bounds.xMax;
            var height = bounds.yMax;
            var tasks = new List<UniTask>();
            
            for (var x = 0; x < width; x++) // Проходим по всем столбцам
            {
                for (var y = 0; y < height; y++) // Проходим по строкам снизу вверх
                {
                    var cellPosition = new Vector3Int(x, y, 0);
                    // Проверяем, есть ли объект в этом месте
                    var entity = GetEntityAt(cellPosition);
                    
                    if (!entity || entity.gameObject == null || entity.GetComponent<Hero>() != null) continue; // Герой не падает
        
                    var targetCell = _getLowestAvailableCell(cellPosition);
                    if (!targetCell.HasValue) continue;
        
                    var move = entity.Move(targetCell.Value);
                    
                    // Добавляем анимацию в последовательность
                    tasks.Add(move);
                }
            }
        
            await UniTask.WhenAll(tasks);
        }

        public async UniTask UpdateGrid()
        {
            // _spawnService.ClearDeadEntities();

            await ApplyGravity();
         
            SpawnEntitiesOnGrid();
        }

        public Cell GetRandomCell(List<Cell> excludedCells = default)
        {
            return null;
            // var availableCells = new List<Cell>();
            //
            // for (var x = 0; x < _cells.GetLength(0); x++)
            // {
            //     for (var y = 0; y < _cells.GetLength(1); y++)
            //     {
            //         var cell = _cells[x, y];
            //         if (!cell.IsAvailableForEntity()) continue;
            //         
            //         if (excludedCells == null)
            //         {
            //             availableCells.Add(cell);
            //         }
            //         else if (!excludedCells.Contains(cell))
            //         {
            //             availableCells.Add(cell); 
            //         }
            //     }
            // }
            //
            // var randomCell = availableCells[Random.Range(0, availableCells.Count)];
            //
            // return randomCell;
        }
        
        private Vector3? _getLowestAvailableCell(Vector3Int startCell)
        {
            for (var y = 0; y < startCell.y; y++) // Проходим снизу вверх до текущей ячейки
            {
                var potentialCellPosition = new Vector3Int(startCell.x, y, 0);
                var tile = groundTilemap.GetTile(potentialCellPosition);
                if (tile == null) continue;
            
                var entityInPotentialCell = GetEntityAt(potentialCellPosition);

                if (entityInPotentialCell == null && !obstacleTilemap.HasTile(potentialCellPosition))
                {
                    return potentialCellPosition; // Возвращаем самую нижнюю доступную ячейку
                }
            }

            return null; // Если доступных ячеек нет, возвращаем null
        }
        
        // private void _populateCellsFromScene()
        // {
            // var foundCells = FindObjectsByType<Cell>(FindObjectsSortMode.None);
            //
            // foreach (var cell in foundCells)
            // {
            //     _cells[cell.Position.x, cell.Position.y] = cell;
            //     cell.Init();
            // }
        // }
    }
}