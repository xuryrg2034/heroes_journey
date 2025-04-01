using System.Collections.Generic;
using Core;
using Grid;
using Services;
using UnityEngine;
namespace Entities.Player.Slash
{
    public class SlashSelectionState : State
    {
        readonly SlashAbility _ability;

        readonly GridService _gridService;
        
        public SlashSelectionState(SlashAbility ability)
        {
            _ability = ability;
            _gridService = ServiceLocator.Get<GridService>();
        }

        Vector3 OriginPosition => _ability.OriginPosition;
        List<Vector3> Directions => _ability.Directions;
        LayerMask  LayerMask => _ability.TilemapLayer;

        public override void OnUpdate()
        {
            base.OnUpdate();

            // TODO: Надо добавить какое то обозначение куда собирается бить герой
            if (Input.GetMouseButtonDown(0))
            {
                var mousePosition = Camera.main.ScreenToWorldPoint(Input.mousePosition);

                var hit = Physics2D.OverlapPoint(mousePosition, LayerMask);
                var entity = hit?.GetComponent<BaseEntity>();

                if (entity != null)
                {
                    SelectEntity(entity);
                }
            }
        }

        void SelectEntity(BaseEntity entity)
        {
            if (entity.GridPosition == OriginPosition)
            {
                _ability.ResetSelection();
                return;
            }

            var isInRange = IsInRange(OriginPosition, entity.GridPosition, 1);

            if (!isInRange) return;

            _ability.ResetSelection();
            
            var targetPositions = GetEntitiesCoords(OriginPosition, entity.GridPosition);
            
            foreach (var position in targetPositions)
            {
                var entityAtGrid = _gridService.GetEntityAt(position);

                if (entityAtGrid != null)
                {
                    _ability.SelectEntity(entityAtGrid);
                }
            }
        }
        
        bool IsInRange(Vector3 origin, Vector3 target, int range)
        {
            var dx = Mathf.Abs(origin.x - target.x);
            var dy = Mathf.Abs(origin.y - target.y);

            // Используем челночное расстояние
            return Mathf.Max(dx, dy) <= range;
        }
        
        List<Vector3> GetEntitiesCoords(Vector3 originPos, Vector3 targetPos)
        {
            var targets = new List<Vector3>();
            // Вектор от героя до клика
            var attackVec = targetPos - originPos;
            var angle = Mathf.Atan2(attackVec.y, attackVec.x) * Mathf.Rad2Deg;

            if (angle < 0) angle += 360;

            // Округляем угол до ближайших 45 градусов (8 направлений)
            var index = Mathf.RoundToInt(angle / 45f) % 8;
            var attackDir = Directions[index];
            // Округляем позицию героя до ячеек сетки

            // Центральная ячейка атаки
            var centerCell = originPos + attackDir;
            Vector3 leftCell, rightCell;

            // Для диагональных направлений берем соседей так, чтобы они вместе с центром формировали "треугольник"
            if (attackDir.x != 0 && attackDir.y != 0)
            {
                leftCell = new Vector3(originPos.x + attackDir.x, originPos.y, 0);
                rightCell = new Vector3(originPos.x, originPos.y + attackDir.y, 0);
            }
            else // для кардинальных направлений – берём ячейки по перпендикуляру от направления
            {
                if (attackDir.x == 0) // вверх или вниз
                {
                    leftCell = centerCell + Vector3.left;
                    rightCell = centerCell + Vector3.right;
                }
                else // влево или вправо
                {
                    leftCell = centerCell + Vector3.up;
                    rightCell = centerCell + Vector3.down;
                }
            }

            targets.Add(centerCell);
            targets.Add(leftCell);
            targets.Add(rightCell);
            
            return targets;
        }
    }
}
