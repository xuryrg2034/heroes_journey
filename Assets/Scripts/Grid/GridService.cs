using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Entities;
using Cysharp.Threading.Tasks;
using Entities.Enemies;
using Entities.Player;
using UnityEngine.Tilemaps;

namespace Grid
{
    /// <summary>
    /// Отвечает за создание и управление игровым полем (сеткой),
    /// а также за объекты, размещенные на этой сетке.
    /// </summary>
    public class GridService
    {
        Tilemap _groundTilemap;

        Tilemap _obstacleTilemap;
        
        SpawnService _spawnService;

        static Vector3 _offsetToTileCenter = new(0.5f, 0.5f, 0); 

        public static Vector3 GridPositionToTileCenter(Vector3Int gridPosition)
        {
            return gridPosition + _offsetToTileCenter;
        }
        
        public GridService(Tilemap groundTilemap, Tilemap obstacleTilemap, SpawnService spawnService)
        {
            _spawnService = spawnService;
            _groundTilemap = groundTilemap;
            _obstacleTilemap = obstacleTilemap;
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
            var bounds = _groundTilemap.cellBounds;

            foreach (var cellPos in bounds.allPositionsWithin)
            {
                // Проверяем, что в клетке есть земля И нет препятствия
                if (_groundTilemap.HasTile(cellPos) && !_obstacleTilemap.HasTile(cellPos))
                {
                    // Переводим координаты сетки в координаты мира
                    var worldPosition = _groundTilemap.CellToWorld(cellPos);
                    var isCellEmpty = GetEntityAt(worldPosition) == null;

                    if (!isCellEmpty) continue;
                    
                    _spawnService.SpawnSmallEnemy(cellPos);
                }
            }
        }

        public Hero SpawnHero(Hero heroPrefab)
        {
            return _spawnService.SpawnHero(heroPrefab);
        }

        public Vector3? GetCell(int x, int y)
        {
            var cellPosition = _groundTilemap.WorldToCell(new Vector3Int(x, y, 0));
            var tile = _groundTilemap.GetTile(cellPosition);
            
            return tile ? cellPosition : null;
        }
        
        public BaseEntity GetEntityAt(Vector3 position)
        {
            return _spawnService.GetSpawnedEntities().Where(e => !e.Health.IsDead).FirstOrDefault(e => e.GridPosition == position);
        }
        
        public async UniTask ApplyGravity()
        {
            var bounds = _groundTilemap.cellBounds;
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

        public Vector3Int GetRandomAdjacentCell(Vector3Int centerCell)
        {
            // Смещения по соседним ячейкам (восьминаправленные)
            var directions = new []
            {
                new Vector3Int(0, 1, 0),   // Вверх
                new Vector3Int(1, 0, 0),   // Вправо
                new Vector3Int(0, -1, 0),  // Вниз
                new Vector3Int(-1, 0, 0),  // Влево
                new Vector3Int(1, 1, 0),   // Вверх-вправо
                new Vector3Int(1, -1, 0),  // Вниз-вправо
                new Vector3Int(-1, -1, 0), // Вниз-влево
                new Vector3Int(-1, 1, 0)   // Вверх-влево
            };

            // Перемешиваем направления (чтобы было более случайно)
            var rng = new System.Random();
            directions = directions.OrderBy(x => rng.Next()).ToArray();

            // Проверяем соседние ячейки
            foreach (var dir in directions)
            {
                var targetCell = centerCell + dir;
                // Проверяем, есть ли тайл на groundTilemap И НЕТ ли препятствия на obstacleTilemap
                if (!_groundTilemap.HasTile(targetCell) || _obstacleTilemap.HasTile(targetCell)) continue;

                return targetCell;
            }

            return centerCell; // Если нет доступных ячеек — возвращаем исходную
        }
        
        Vector3Int? _getLowestAvailableCell(Vector3Int startCell)
        {
            for (var y = 0; y < startCell.y; y++) // Проходим снизу вверх до текущей ячейки
            {
                var potentialCellPosition = new Vector3Int(startCell.x, y, 0);
                var tile = _groundTilemap.GetTile(potentialCellPosition);
                if (tile == null) continue;
            
                var entityInPotentialCell = GetEntityAt(potentialCellPosition);

                if (entityInPotentialCell == null && !_obstacleTilemap.HasTile(potentialCellPosition))
                {
                    return potentialCellPosition; // Возвращаем самую нижнюю доступную ячейку
                }
            }

            return null; // Если доступных ячеек нет, возвращаем null
        }
    }
}