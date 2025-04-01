using Entities.Components;
using UnityEngine;

namespace Interfaces
{
    public interface IBaseEntity
    {
        public Health Health { get; }
        
        public Vector3Int GridPosition { get; }
    }
}
