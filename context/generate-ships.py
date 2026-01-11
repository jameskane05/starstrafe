#
# generate-ships.py - Starfighter Generator
#
# Generates compact starfighter-style ships with wings and engine nacelles
# Run: blender --background --python generate-ships.py
#

import sys
import os
import bpy
import bmesh
from math import sqrt, radians, pi, cos, sin
from mathutils import Vector, Matrix
from random import random, seed, uniform, randint, randrange, choice
from enum import IntEnum
from colorsys import hls_to_rgb

DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(DIR, '..', 'public', 'ships')

class Material(IntEnum):
    hull = 0
    hull_accent = 1
    hull_dark = 2
    engine_glow = 3
    cockpit = 4

def reset_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for mat in bpy.data.materials:
        if not mat.users:
            bpy.data.materials.remove(mat)

def create_materials():
    ret = []
    
    # Base hull color - grays, whites, with slight tint
    hull_hue = random()
    hull_base = hls_to_rgb(hull_hue, uniform(0.4, 0.7), uniform(0.0, 0.15))
    hull_base = (*hull_base, 1.0)
    
    # Accent color - more saturated
    accent_hue = (hull_hue + uniform(0.05, 0.15)) % 1.0
    accent_color = hls_to_rgb(accent_hue, uniform(0.4, 0.6), uniform(0.5, 0.8))
    accent_color = (*accent_color, 1.0)
    
    # Engine glow
    glow_hue = choice([0.0, 0.1, 0.55, 0.65])  # Red, orange, cyan, blue
    glow_color = hls_to_rgb(glow_hue, 0.6, 1.0)
    glow_color = (*glow_color, 1.0)
    
    for material in Material:
        mat = bpy.data.materials.new(name=material.name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        
        if material == Material.hull:
            bsdf.inputs['Base Color'].default_value = hull_base
            bsdf.inputs['Metallic'].default_value = 0.3
            bsdf.inputs['Roughness'].default_value = 0.5
        elif material == Material.hull_accent:
            bsdf.inputs['Base Color'].default_value = accent_color
            bsdf.inputs['Metallic'].default_value = 0.2
            bsdf.inputs['Roughness'].default_value = 0.4
        elif material == Material.hull_dark:
            dark = tuple(c * 0.2 for c in hull_base[:3]) + (1.0,)
            bsdf.inputs['Base Color'].default_value = dark
            bsdf.inputs['Metallic'].default_value = 0.6
            bsdf.inputs['Roughness'].default_value = 0.3
        elif material == Material.engine_glow:
            bsdf.inputs['Base Color'].default_value = glow_color
            bsdf.inputs['Emission Color'].default_value = glow_color
            bsdf.inputs['Emission Strength'].default_value = 8.0
        elif material == Material.cockpit:
            bsdf.inputs['Base Color'].default_value = (0.1, 0.15, 0.2, 1.0)
            bsdf.inputs['Metallic'].default_value = 0.9
            bsdf.inputs['Roughness'].default_value = 0.1
        
        ret.append(mat)
    return ret

def add_to_mesh(bm, verts, material_index=0):
    """Helper to set material on new faces"""
    for v in verts:
        for f in v.link_faces:
            f.material_index = material_index

def create_fuselage(bm):
    """Create the main cockpit/fuselage body"""
    style = choice(['pointed', 'rounded', 'angular', 'pod'])
    
    if style == 'pointed':
        # Pointed nose like X-wing
        length = uniform(1.5, 2.5)
        width = uniform(0.4, 0.7)
        height = uniform(0.3, 0.5)
        
        # Main body
        result = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
            segments=8, radius1=width*0.3, radius2=width, depth=length*0.6,
            matrix=Matrix.Rotation(radians(90), 4, 'Y'))
        add_to_mesh(bm, result['verts'], Material.hull)
        
        # Rear section
        result = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
            segments=8, radius1=width, radius2=width*0.7, depth=length*0.4,
            matrix=Matrix.Translation(Vector((-length*0.5, 0, 0))) @ Matrix.Rotation(radians(90), 4, 'Y'))
        add_to_mesh(bm, result['verts'], Material.hull)
        
    elif style == 'rounded':
        # Rounded like Naboo starfighter
        length = uniform(1.8, 2.8)
        width = uniform(0.5, 0.8)
        
        result = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=width,
            matrix=Matrix.Scale(length/width/2, 4, Vector((1,0,0))))
        add_to_mesh(bm, result['verts'], Material.hull)
        
    elif style == 'angular':
        # Angular like TIE cockpit ball but stretched
        size = uniform(0.6, 1.0)
        bmesh.ops.create_cube(bm, size=size)
        # Bevel edges for less blocky look
        edges = [e for e in bm.edges]
        bmesh.ops.bevel(bm, geom=edges, offset=size*0.1, segments=2)
        for f in bm.faces:
            f.material_index = Material.hull
            
    else:  # pod
        # Bubble cockpit like droid fighters
        radius = uniform(0.5, 0.8)
        result = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
        add_to_mesh(bm, result['verts'], Material.hull)
        
        # Stretch slightly
        bmesh.ops.scale(bm, vec=Vector((uniform(1.2, 1.8), 1, 1)), verts=bm.verts)
    
    return style

def add_cockpit_canopy(bm, fuselage_style):
    """Add a cockpit canopy/window"""
    if random() > 0.3:
        canopy_size = uniform(0.2, 0.4)
        y_offset = uniform(0.1, 0.25)
        
        if fuselage_style in ['pointed', 'rounded']:
            result = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=canopy_size,
                matrix=Matrix.Translation(Vector((uniform(-0.2, 0.3), y_offset, 0))))
            add_to_mesh(bm, result['verts'], Material.cockpit)
        else:
            result = bmesh.ops.create_cube(bm, size=canopy_size*1.5,
                matrix=Matrix.Translation(Vector((0, y_offset, 0))))
            add_to_mesh(bm, result['verts'], Material.cockpit)

def add_wings(bm):
    """Add wings - the key starfighter feature"""
    wing_style = choice(['x-wing', 'swept', 'delta', 'vertical', 'ring', 'stub'])
    
    if wing_style == 'x-wing':
        # Four wings in X pattern
        wing_length = uniform(1.5, 2.5)
        wing_width = uniform(0.6, 1.0)
        wing_thickness = uniform(0.03, 0.08)
        spread_angle = uniform(15, 35)
        
        for i in range(4):
            angle = spread_angle if i < 2 else -spread_angle
            y_sign = 1 if i % 2 == 0 else -1
            
            # Wing panel
            result = bmesh.ops.create_cube(bm, size=1,
                matrix=Matrix.Translation(Vector((uniform(-0.3, 0.1), 0, wing_length/2))) @
                       Matrix.Scale(wing_width, 4, Vector((1,0,0))) @
                       Matrix.Scale(wing_thickness, 4, Vector((0,1,0))) @
                       Matrix.Scale(wing_length, 4, Vector((0,0,1))))
            
            # Position and rotate
            bmesh.ops.rotate(bm, verts=result['verts'], cent=(0,0,0),
                matrix=Matrix.Rotation(radians(angle * y_sign), 3, 'X'))
            bmesh.ops.translate(bm, verts=result['verts'], vec=Vector((0, 0, 0)))
            
            add_to_mesh(bm, result['verts'], Material.hull if i % 2 == 0 else Material.hull_accent)
            
    elif wing_style == 'swept':
        # Swept back wings like a jet
        wing_length = uniform(1.2, 2.0)
        wing_width = uniform(0.8, 1.4)
        sweep = uniform(0.3, 0.7)
        
        for side in [-1, 1]:
            verts = [
                bm.verts.new((0, 0, 0.2 * side)),
                bm.verts.new((-wing_width * sweep, 0, wing_length * side)),
                bm.verts.new((wing_width * (1-sweep), 0, wing_length * side)),
                bm.verts.new((wing_width * 0.3, 0, 0.3 * side)),
            ]
            face = bm.faces.new(verts if side > 0 else reversed(verts))
            face.material_index = Material.hull_accent
            
            # Extrude for thickness
            result = bmesh.ops.extrude_face_region(bm, geom=[face])
            bmesh.ops.translate(bm, verts=[v for v in result['geom'] if isinstance(v, bmesh.types.BMVert)],
                vec=Vector((0, uniform(0.03, 0.08), 0)))
                
    elif wing_style == 'delta':
        # Delta/triangle wings
        wing_span = uniform(1.5, 2.5)
        wing_length = uniform(1.0, 1.8)
        
        for side in [-1, 1]:
            verts = [
                bm.verts.new((wing_length * 0.5, 0, 0)),
                bm.verts.new((-wing_length * 0.5, 0, wing_span * 0.5 * side)),
                bm.verts.new((-wing_length * 0.3, 0, 0.1 * side)),
            ]
            face = bm.faces.new(verts if side > 0 else reversed(verts))
            face.material_index = Material.hull_accent
            
            result = bmesh.ops.extrude_face_region(bm, geom=[face])
            bmesh.ops.translate(bm, verts=[v for v in result['geom'] if isinstance(v, bmesh.types.BMVert)],
                vec=Vector((0, uniform(0.04, 0.1), 0)))
                
    elif wing_style == 'vertical':
        # Vertical wings like TIE fighters
        wing_height = uniform(1.5, 2.5)
        wing_width = uniform(1.0, 1.8)
        
        for side in [-1, 1]:
            # Hexagonal or rectangular panel
            if random() > 0.5:
                # Hexagonal
                result = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
                    segments=6, radius1=wing_height*0.5, radius2=wing_height*0.5, depth=0.05,
                    matrix=Matrix.Translation(Vector((0, 0, wing_width * 0.6 * side))) @
                           Matrix.Rotation(radians(90), 4, 'Y'))
            else:
                # Rectangular
                result = bmesh.ops.create_cube(bm, size=1,
                    matrix=Matrix.Translation(Vector((0, 0, wing_width * 0.6 * side))) @
                           Matrix.Scale(0.05, 4, Vector((0,0,1))) @
                           Matrix.Scale(wing_height, 4, Vector((0,1,0))) @
                           Matrix.Scale(wing_width * 0.8, 4, Vector((1,0,0))))
            add_to_mesh(bm, result['verts'], Material.hull_dark)
            
            # Wing strut
            result = bmesh.ops.create_cube(bm, size=1,
                matrix=Matrix.Translation(Vector((0, 0, wing_width * 0.3 * side))) @
                       Matrix.Scale(0.1, 4, Vector((1,0,0))) @
                       Matrix.Scale(0.1, 4, Vector((0,1,0))) @
                       Matrix.Scale(wing_width * 0.3, 4, Vector((0,0,1))))
            add_to_mesh(bm, result['verts'], Material.hull)
            
    elif wing_style == 'ring':
        # Ring wing like Jedi starfighter hyperdrive ring
        ring_radius = uniform(1.2, 2.0)
        ring_thickness = uniform(0.1, 0.2)
        
        result = bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False,
            segments=32, radius1=ring_radius, radius2=ring_radius, depth=ring_thickness,
            matrix=Matrix.Rotation(radians(90), 4, 'Y'))
        add_to_mesh(bm, result['verts'], Material.hull_accent)
        
        # Inner ring
        result = bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False,
            segments=32, radius1=ring_radius*0.85, radius2=ring_radius*0.85, depth=ring_thickness*1.5,
            matrix=Matrix.Rotation(radians(90), 4, 'Y'))
        add_to_mesh(bm, result['verts'], Material.hull_dark)
        
    else:  # stub
        # Small stub wings
        wing_length = uniform(0.5, 0.8)
        
        for side in [-1, 1]:
            result = bmesh.ops.create_cube(bm, size=1,
                matrix=Matrix.Translation(Vector((uniform(-0.2, 0.2), 0, wing_length * 0.6 * side))) @
                       Matrix.Scale(uniform(0.4, 0.7), 4, Vector((1,0,0))) @
                       Matrix.Scale(uniform(0.05, 0.12), 4, Vector((0,1,0))) @
                       Matrix.Scale(wing_length, 4, Vector((0,0,1))))
            add_to_mesh(bm, result['verts'], Material.hull_accent)
    
    return wing_style

def add_engines(bm, wing_style):
    """Add engine nacelles"""
    engine_style = choice(['rear', 'wing_tip', 'pod', 'central'])
    
    engine_radius = uniform(0.1, 0.25)
    engine_length = uniform(0.3, 0.6)
    
    positions = []
    
    if engine_style == 'rear' or wing_style == 'vertical':
        # Engines at rear of fuselage
        num_engines = choice([1, 2, 3])
        spacing = 0.25
        for i in range(num_engines):
            z_off = (i - (num_engines-1)/2) * spacing
            positions.append(Vector((-0.8, 0, z_off)))
            
    elif engine_style == 'wing_tip':
        # Engines at wing tips
        wing_span = uniform(1.0, 1.8)
        positions = [
            Vector((uniform(-0.3, 0.1), 0, wing_span)),
            Vector((uniform(-0.3, 0.1), 0, -wing_span)),
        ]
        if random() > 0.5:  # Maybe 4 engines
            positions.extend([
                Vector((uniform(-0.3, 0.1), wing_span * 0.3, wing_span * 0.5)),
                Vector((uniform(-0.3, 0.1), -wing_span * 0.3, wing_span * 0.5)),
                Vector((uniform(-0.3, 0.1), wing_span * 0.3, -wing_span * 0.5)),
                Vector((uniform(-0.3, 0.1), -wing_span * 0.3, -wing_span * 0.5)),
            ])
            
    elif engine_style == 'pod':
        # Engine pods on sides
        pod_offset = uniform(0.5, 0.9)
        positions = [
            Vector((-0.3, 0, pod_offset)),
            Vector((-0.3, 0, -pod_offset)),
        ]
        engine_radius *= 1.5
        engine_length *= 1.5
        
    else:  # central
        positions = [Vector((-0.7, 0, 0))]
        engine_radius *= 2
        engine_length *= 1.5
    
    for pos in positions:
        # Engine housing
        result = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
            segments=12, radius1=engine_radius, radius2=engine_radius * 0.8, depth=engine_length,
            matrix=Matrix.Translation(pos) @ Matrix.Rotation(radians(90), 4, 'Y'))
        add_to_mesh(bm, result['verts'], Material.hull_dark)
        
        # Engine glow
        result = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
            segments=12, radius1=engine_radius * 0.7, radius2=engine_radius * 0.5, depth=engine_length * 0.3,
            matrix=Matrix.Translation(pos + Vector((-engine_length*0.5, 0, 0))) @ Matrix.Rotation(radians(90), 4, 'Y'))
        add_to_mesh(bm, result['verts'], Material.engine_glow)

def add_details(bm):
    """Add small details like guns, sensors"""
    # Nose guns
    if random() > 0.4:
        gun_length = uniform(0.4, 0.8)
        gun_radius = uniform(0.02, 0.05)
        gun_spread = uniform(0.15, 0.35)
        
        for side in [-1, 1]:
            result = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
                segments=6, radius1=gun_radius, radius2=gun_radius, depth=gun_length,
                matrix=Matrix.Translation(Vector((gun_length/2 + 0.5, 0, gun_spread * side))) @
                       Matrix.Rotation(radians(90), 4, 'Y'))
            add_to_mesh(bm, result['verts'], Material.hull_dark)
    
    # Wing-mounted weapons
    if random() > 0.5:
        for side in [-1, 1]:
            pos = Vector((uniform(0, 0.5), 0, uniform(0.8, 1.5) * side))
            result = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
                segments=6, radius1=0.03, radius2=0.03, depth=0.5,
                matrix=Matrix.Translation(pos) @ Matrix.Rotation(radians(90), 4, 'Y'))
            add_to_mesh(bm, result['verts'], Material.hull_dark)
    
    # Sensor dish or antenna
    if random() > 0.6:
        result = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False,
            segments=8, radius1=0.0, radius2=0.1, depth=0.15,
            matrix=Matrix.Translation(Vector((0.3, 0.3, 0))) @ Matrix.Rotation(radians(-90), 4, 'X'))
        add_to_mesh(bm, result['verts'], Material.hull_accent)

def generate_starfighter(random_seed=''):
    if random_seed:
        seed(random_seed)
    
    bm = bmesh.new()
    
    # Build the ship
    fuselage_style = create_fuselage(bm)
    add_cockpit_canopy(bm, fuselage_style)
    wing_style = add_wings(bm)
    add_engines(bm, wing_style)
    add_details(bm)
    
    # Create mesh
    me = bpy.data.meshes.new('Starfighter')
    bm.to_mesh(me)
    bm.free()
    
    obj = bpy.data.objects.new('Starfighter', me)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    
    # Center and orient
    bpy.ops.object.origin_set(type='ORIGIN_CENTER_OF_MASS')
    obj.location = (0, 0, 0)
    
    # Add materials
    materials = create_materials()
    for mat in materials:
        me.materials.append(mat)
    
    # Smooth shading
    bpy.ops.object.shade_smooth()
    
    return obj

def export_glb(filepath):
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_materials='EXPORT'
    )

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    num_ships = 10
    
    for i in range(num_ships):
        print(f"Generating starfighter {i + 1}/{num_ships}...")
        reset_scene()
        
        obj = generate_starfighter(random_seed=str(i * 7777 + 42))
        
        # Normalize scale
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        
        bbox = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        dims = Vector((
            max(v.x for v in bbox) - min(v.x for v in bbox),
            max(v.y for v in bbox) - min(v.y for v in bbox),
            max(v.z for v in bbox) - min(v.z for v in bbox)
        ))
        max_dim = max(dims)
        scale_factor = 1.5 / max_dim
        obj.scale *= scale_factor
        bpy.ops.object.transform_apply(scale=True)
        
        output_path = os.path.join(OUTPUT_DIR, f'enemy-ship-{i}.glb')
        export_glb(output_path)
        print(f"  Exported to {output_path}")
    
    print(f"\nDone! Generated {num_ships} starfighters")

if __name__ == "__main__":
    main()
