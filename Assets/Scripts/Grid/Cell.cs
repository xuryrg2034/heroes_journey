using System;
using System.Collections.Generic;
using Entities;
using JetBrains.Annotations;
using Services;
using UnityEngine;

namespace Grid
{
    public class Cell : MonoBehaviour
    {
        [SerializeField] private Vector2Int position;
        [SerializeField] private CellType cellType;

        private GridService _gridService;
        
        private SpriteRenderer _sr;
        
        private Color _initColor;
        
        private static List<Vector2Int> _directions = new()
        {
            new Vector2Int(1, 0), // 0° - вправо
            new Vector2Int(1, 1), // 45° - вверх-вправо
            new Vector2Int(0, 1), // 90° - вверх
            new Vector2Int(-1, 1), // 135° - вверх-влево
            new Vector2Int(-1, 0), // 180° - влево
            new Vector2Int(-1, -1), // 225° - вниз-влево
            new Vector2Int(0, -1), // 270° - вниз
            new Vector2Int(1, -1), // 315° - вниз-вправо
        };
        
        public Vector2Int Position => position;

        public CellType Type
        {
            get => cellType;
            set => cellType = value;
        }

        public void Init()
        {
            _gridService = ServiceLocator.Get<GridService>();
            _sr = GetComponent<SpriteRenderer>();
            
            if (cellType == CellType.Blocked)
            {
                _sr.color = Color.white;   
            }
            
            _initColor = _sr.color;
        }

        public bool IsAvailableForEntity()
        {
            return Type != CellType.Blocked;
        }

        public List<Cell> GetNeighbors()
        {
            var neighbors = new List<Cell>();

            foreach (var direction in _directions)
            {
                var nextPosition = Position + direction;
                var cell = _gridService.GetCell(nextPosition.x, nextPosition.y);

                // if (cell)
                // {
                //     // neighbors.Add(cell);
                // }
            }

            return neighbors;
        }

        [CanBeNull]
        public BaseEntity GetEntity()
        {
            return null;
            // return _gridService.GetEntityAt(Position);
        }

        public void Highlite(bool value)
        {
            _sr.color = value ? Color.yellow : _initColor;
        }

        public void SetType(CellType type)
        {
            cellType = type;

            if (cellType == CellType.Movable)
            {
                var a = new Color(72, 72, 72, 0);
                _sr.color = a;
            }
        }
    }

    /// <summary>
    /// Тип клетки: пустая, непроходимая, разрушаемая, ловушка и т.д.
    /// </summary>
    public enum CellType
    {
        Movable,
        Blocked,
    }
}